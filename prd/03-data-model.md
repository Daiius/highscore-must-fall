# 03. データモデル

本章は正規スキーマ（`shared`）と DB スキーマ（`database` / Drizzle + MySQL 8.4）を定める。
ドメイン事実は [01](./01-game-domain.md)、投入時の検証フローは [04](./04-ingestion.md) を参照。

> 表記は概念設計。実際の型・制約は Drizzle 実装時に確定する（カラム名・enum 値は本章を正とする）。

---

## 1. 正規スキーマ（`shared` / Zod）

- 1 run を表す**正規レコード**を Zod で定義し、`shared` に置く。これが唯一の定義元（単一の真実）。
- ここから **TS 型**（`z.infer`）と **JSON Schema**（MCP 入力・ドキュメント・他言語クライアント用）を導出する。
- レコードは **`schema_version`** を持つ。破壊的変更時はバージョンを上げ、旧→新の**変換器**を `shared` に用意する。
- 概念構造（人間可読サンプルは [01](./01-game-domain.md) §8）:

```
RunRecord {
  schema_version: string
  game: string                    // 既定 "UTOPIA MUST FALL"
  played_at?: string (ISO)        // 省略時はサーバ側で投入時刻
  result: {
    days_survived, final_score, aliens_defeated, nukes_launched, apocalypse_bonus: int
    // 未知指標は extra(JSON) として許容（raw_payload に温存）
  }
  upgrade_history: UpgradeEntry[]  // 順序保持。entry_type を持つ（下記）
  reward_ledger: RewardEntry[]
}
UpgradeEntry {
  week_index: int (1..)
  order_in_week: int (1..)         // 週内の位置（reroll 含む）
  entry_type: "upgrade" | "reroll"
  name?: string                    // upgrade のとき。catalog 名寄せ対象
  flavor_text?: string             // reroll のとき。verbatim（集計対象外）
}
RewardEntry { name: string, count: int, points: int }
```

- **整合チェック**（`shared` に集約。全投入ルート共通の品質ゲート）:
  - `result.apocalypse_bonus === Σ(reward_ledger[*].points)` … 不一致は **warning**（確定可・要確認）。
  - 件数・数値の基本検証（負値・型）… **error**（確定不可）。
  - error / warning を区別する（[04](./04-ingestion.md) のレビュー層が使用）。

## 2. DB テーブル概要

| テーブル | 役割 | owner_id |
|---|---|---|
| `run` | run のコア指標・来歴・状態（ホット行は細く） | ○ |
| `run_payload` | `raw_payload`(JSON) と重いメタを分離保持 | ○ |
| `upgrade_entry` | アップグレード/リロールの順序付きエントリ | ○ |
| `reward_entry` | リワード台帳の行 | ○ |
| `upgrade_catalog` / `reward_catalog` | 名寄せマスタ（**グローバル**。§5 の注意） | ✕ |
| `catalog_alias` | 別名→正規エントリの対応（マージ用） | ✕ |
| `run_image` | スクショ証跡（BlobStore キー参照） | ○ |
| （認証テーブル） | better-auth が管理（user/session/account 等） | — |

> **原則**: 全トップレベルの**ユーザーデータ**テーブルに `owner_id`（= 認証済みユーザー ID）を持たせ、
> 複合インデックスの**先頭**に置く。アプリ層は必ず `owner_id` を条件に含める（他ユーザーのデータに触れない）。
> カタログは「ゲームの客観的事実」でありユーザーデータではないため owner を持たない（§5 で詳述）。

## 3. テーブル定義（概念）

### 3.1 `run`（コア・ホット行）

| カラム | 型 | 備考 |
|---|---|---|
| `id` | string(PK) | cuid/uuid |
| `owner_id` | string(FK user) | 索引先頭 |
| `game` | string | 既定 "UTOPIA MUST FALL" |
| `played_at` | datetime | 既定=投入時刻、手動上書き可（スクショに日付なし） |
| `status` | enum(`draft`,`confirmed`) | 部分ドラフト許容（[04](./04-ingestion.md)） |
| `source` | enum(`file_import`,`paste`,`mcp`,`api`,`screenshot_auto`) | 来歴 |
| `schema_version` | string | |
| `days_survived` | int | |
| `final_score` | int | 分析主対象 |
| `aliens_defeated` | int | |
| `nukes_launched` | int | |
| `apocalypse_bonus` | int | |
| `reroll_count` | int | 非正規化（高速分析用。`upgrade_entry` から導出可能だが冗長保持） |
| `created_at` / `updated_at` | datetime | |

インデックス: `(owner_id, played_at)` / `(owner_id, final_score)` / `(owner_id, status)`。

### 3.2 `run_payload`（重い JSON を分離）

| カラム | 型 | 備考 |
|---|---|---|
| `run_id` | string(PK/FK) | 1:1 |
| `owner_id` | string | |
| `raw_payload` | json | 正規スキーマ全体を丸ごと（未知項目温存・再処理/監査用） |
| `llm_model` | string? | 自前/サーバ LLM のモデル名等 |
| `source_note` | string? | どのスクショから起こしたか等のメモ |

> 分離理由: `run` の一覧/集計スキャンで巨大 JSON を読み込まないため（[Q8] 細いホット行）。

### 3.3 `upgrade_entry`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | string(PK) | |
| `owner_id` | string | |
| `run_id` | string(FK) | |
| `week_index` | int | 1.. |
| `order_in_week` | int | 週内の位置（reroll 含む） |
| `entry_type` | enum(`upgrade`,`reroll`) | |
| `upgrade_catalog_id` | string(FK)? | `upgrade` のみ。reroll は null |
| `upgrade_order` | int? | **アップグレードのみ**の通し番号（reroll は null）。「位置Nのアップグレード」分析用 |
| `flavor_text` | string? | reroll の verbatim（集計対象外） |

インデックス: `(run_id)` / `(upgrade_catalog_id, week_index)` / `(owner_id, upgrade_catalog_id)`。

### 3.4 `reward_entry`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | string(PK) | |
| `owner_id` | string | |
| `run_id` | string(FK) | |
| `reward_catalog_id` | string(FK) | |
| `count` | int | 発生回数 |
| `points` | int | 合計点 |

インデックス: `(run_id)` / `(owner_id, reward_catalog_id)`。

### 3.5 `upgrade_catalog` / `reward_catalog`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | string(PK) | |
| `canonical_key` | string(unique) | 正規化キー（大文字化・トリム・記号正規化。名寄せの照合キー） |
| `display_name` | string | 表示名 |
| `verified` | bool | 既定 false（unverified で自動登録） |
| `first_seen_run_id` | string? | 初出 run |
| `created_at` | datetime | |

> リッチ属性（カテゴリ・色・レアリティ）は Phase2（[06](./06-analysis.md)）。

### 3.6 `catalog_alias`（マージ用）

| カラム | 型 | 備考 |
|---|---|---|
| `id` | string(PK) | |
| `catalog_kind` | enum(`upgrade`,`reward`) | |
| `catalog_id` | string(FK) | 統合先の正規エントリ |
| `alias_key` | string(unique) | 別名の正規化キー |

> マージ操作: B を A に統合 = B 配下の `*_entry` を A に付け替え、B の `canonical_key` を A の alias として登録、B を削除。

### 3.7 `run_image`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | string(PK) | |
| `owner_id` | string | |
| `run_id` | string(FK) | run 削除でカスケード削除（DB 行＋BlobStore 実体） |
| `section` | enum(`result`,`upgrade_history`,`reward_ledger`,`other`) | どの画面か |
| `storage_key` | string | `BlobStore` のキー |
| `content_type` | string | png/jpeg/webp |
| `byte_size` | int | |
| `width` / `height` | int? | 任意 |
| `created_at` | datetime | |

- MVP のバリデーション: **section あたり1枚（1 run 最大3枚）**、1枚 ≤ 10MB、保存時に EXIF 除去。
  スキーマ自体は将来の複数枚に耐える。配信は認証エンドポイント経由のみ（[02](./02-architecture.md) §7・[04](./04-ingestion.md)）。

## 4. 整合チェック（再掲・実装位置）

- ルールは `shared`（正規スキーマ由来）に置き、server の投入経路すべてが通す。
- 既知ルール: `apocalypse_bonus == Σ(reward.points)`（warning）。
- DB 制約ではなくアプリ層チェックとする（warning は確定を許すため）。

## 5. マルチテナントとカタログの所有

- **ユーザーデータ**（run / *_entry / run_image / run_payload）は `owner_id` で厳格分離（MVP=private、[05](./05-auth-and-privacy.md)）。
- **カタログはグローバル**（owner を持たない）とする。アップグレード/リワード名は**ゲームの客観的事実**であり、
  個人データではない。グローバルにすることで将来の横断統計（[06](./06-analysis.md) Phase2）が名寄せ済みで直接行える。
  - 未知名は誰の投入でも unverified で自動登録され、**中央（管理者）でキュー的に verify/マージ**する。
  - ⚠️ **この「カタログ=グローバル」は grill で明示的に決めていない設計判断**。マルチユーザーでの汚染懸念
    （悪意ある投入が unverified を増やす）とのトレードオフがある。要確認（`.claude-personal/TASKS.md`）。
    代替案: カタログを owner ごとに持ち、横断統計時にマッピングする（分離は固いが集計が複雑化）。

## 6. パフォーマンス原則

- 規模感: 通常1ユーザー内・最大 ~1万 run（≈ upgrade 19万行 / reward 13万行）。MySQL 8.4 には十分小さい。
- **事前集計テーブルは作らない**。素のクエリで実装し、実測で遅いクエリが出たら初めて導入。
- 分析クエリ主役: `upgrade_entry` を `upgrade_catalog_id × week_index` で grouping し `run.final_score` と相関（[06](./06-analysis.md)）。
- (オプション) 頻出する `raw_payload` 内項目は MySQL の**生成カラム**で昇格してインデックス可能にする（migration 最小）。
