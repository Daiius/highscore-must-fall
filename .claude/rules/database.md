# ルール: データベース（`packages/database` / Drizzle + MySQL 8.4）

## 方針
- ORM は **Drizzle ORM 1.0 RC**（最新 RC を catalog で exact pin）。スキーマ・マイグレーション・seed・DB クライアントは `database` に集約。
- スキーマは [schema-and-contract.md](./schema-and-contract.md) の正規スキーマ（`shared`）に整合させる。

## マルチテナント / セキュリティ境界（必須）
- **全トップレベルテーブルに `owner_id` を持たせる**（= 認証済みユーザー ID）。これは将来の備えでなく**今すぐ効くデータ分離境界**。
- 一覧/集計クエリの**複合インデックスは `owner_id` を先頭**に置く（例: `(owner_id, played_at)`, `(owner_id, final_score)`）。
- アプリ層で必ず `owner_id` を条件に含める（他ユーザーのデータに触れない）。

## run レコード（ハイブリッド保存）
- **型付きコアカラム**（`final_score`, `days_survived`, `aliens_defeated`, `nukes_launched`, `apocalypse_bonus`, `played_at` 等）= 集計・ソート用、インデックス可能。
- **`raw_payload`(JSON)** = 正規スキーマ全体を丸ごと保持（未知項目で migration 不要・再処理/監査用）。
  - **ホット行から分離**する（別テーブル or 一覧/集計で `SELECT *` しない）。巨大 JSON を一覧スキャンで読み込まない。
- **来歴メタ**（`source`, `schema_version`, LLM モデル名 等）。
- `upgrade_entry` / `reward_entry` は集計用に**正規化テーブルへ展開**（JSON だけに埋めない）。
  - `upgrade_entry`: `entry_type`(`upgrade`|`reroll`)・週・週内取得順・(`upgrade` のみ)catalog 紐付け。
  - インデックス: `(run_id)`, `(upgrade_catalog_id, week_index)` 系。

## カタログ

> **⚠️ 未実装（2026-07-12 時点）**: **カタログ管理 UI・孤児掃除**は**まだコードに無い**。
> **これらは後続 PR で実装する仕様であり、「既にそうなっている」前提で判断しないこと。**
> 一方 **`verified` の機能ゲート外し**と **`evidence`**（`catalog-data.ts` の証拠フィールド・
> `seed ⊆ samples` テスト）は**実装済み**。実装が追いつくたびにこの注記ごと更新する
> （正典: [`prd/08-catalog-lifecycle.md`](../../prd/08-catalog-lifecycle.md)）。

- `upgrade_catalog` / `reward_catalog`: 正規キー・表示名・`unverified` フラグ・エイリアス。
- **カタログは投入時の選択母集団が基本**。unverified 自動登録はゲーム更新にリスト整備が追いつかない期間の補助（prd/01 §7）。
- **名称リストの正典は seed**（`packages/database/src/catalog-data.ts`。投入は `seed.ts`）。読み取りミス疑いは seed に入れず、ローカル疑義リスト（`.claude-personal/catalog-suspects.md`）→検証後に昇格。リロール名（DIGITIZE CONSCIOUSNESS 等）は **upgrade に入れない**。
- **`verified` は `evidence` の導出値**。各エントリは `evidence`（突合した `prd/samples/` の画像名。未検証は `null`）を持ち、`verified = evidence !== null`。**DB に `evidence` は持たせない**（正典は seed 一箇所）。**verify を API / 管理 UI から立てない**——昇格は必ず「画像を `prd/samples/` にコミット＋`evidence` を書く」PR を通す。手続きの正典は [`prd/08-catalog-lifecycle.md`](../../prd/08-catalog-lifecycle.md)。
- **`seed ⊆ samples`**: すべての `evidence` は `prd/samples/` に実在する画像を指すこと。**`seed ⊆ series`**: seed の全名称は `shared/src/series.ts` に系統を持つか、**未分類リストに明示登録**されていること。どちらも `database/src/__tests__/catalog-seed.test.ts` が強制。逆方向は制約にしない（series/samples はいずれも seed の上位集合）。**スクショ収集の指針は [`prd/samples/README.md`](../../prd/samples/README.md)**。
- **未分類は一級市民**。系統が分からない名前は未分類リストに1行足せばよい（「調べた上で分類しない」に限定しない。新要素は分類が分かるまで未分類でよい）。分析では `unknown` バケットとして**そのまま集計に乗る**（除外しない。prd/06 §1.1）。
- **`verified` は表示専用の属性**。影響してよいのは (1) 語句単位の「未検証」バッジ (2) カタログ管理 UI のフィルタ (3) 裏取り済みの名前への「もしかして」の抑制 **の3つだけ**。**投入・確定・分析・サジェストの候補プールを `verified` で分岐させない**（自動確定ゲートに名前の条件を置かない・サジェスト候補プールを絞らない・未検証の語句も集計に乗せる）。機能の前提条件にすると、ゲームのアップデートに開発者が追いつけない期間＝自動化がいちばん要る期間に、その機能が死ぬ。(3) は逆に、抑制を外すと**正しい名前の行に自動登録された誤読が並ぶ**（`CLOSE SHAVE`→`CL0SE SHAVE`）＝誤読への逆誘導になるため要る（新要素は unverified なので抑制されず、機能は死なない）。`run.status`(draft/confirmed) とも別レイヤー（confirmed = 分析に算入してよいという投入者の承認）。→ prd/08 §9・prd/06 §1.1。
- **孤児掃除**: 「unverified・seed 外・`*_entry` から参照ゼロ・alias 統合先でもない」行は誤読の残骸（run 編集での名前訂正・run 削除で必ず溜まる）。管理 UI から**明示実行**で削除する（自動削除しない）。詳細は prd/08 §7。
- **種別 `kind`**（`upgrade_catalog` のみ）: `contract`（既定） / `opportunity_upgrade`(OU)。OU はラン跨ぎ恒久解禁のメタ進行だが、UPGRADE HISTORY 上は通常アップグレードと同様に色付きで載る（例 `CONTEXT SWITCH`）。**記録は通常アップグレードと同じ**（`entry_type` に第3種は足さない）。`kind` は `unverified` 同様、後から人手で付与/検証する「一応後から区別できる」程度の属性。
- **`reward_catalog` は run 内 reward（ゲーム内 "performance bonus" = `apocalypse_bonus` の内訳）のプール**。**Steam 実績(31個)とは別系統**（名前が一部重複するだけ。実績 `Schadenfreude` の定義が両レイヤーの別物性を裏付ける）。**Steam 実績名を seed / カタログに混入させない**。プールは run スクショ投入で unverified 自動登録して育てる。
- **リロール(Citizen Proposals)は手書きの有限固定プール**（CHANGELOG が個数を数えて手動追加）だが、**カタログには登録しない**（`entry_type=reroll` で位置・回数のみ集計、フレーバーは任意で verbatim 保存）。完全な原文名リストは Web に無く、スクショが唯一の一次情報。

## パフォーマンス
- 規模感: 通常1ユーザー内・最大 ~1万 run。**事前集計テーブルは作らない**（素のクエリ→実測で遅ければ導入）。
- キャッシュ／事前集計を後から入れるときは、**語句のマージ・訂正・系統分類の追加がいずれ分析結果へ反映される経路を必ず残す**（即時無効化でも、パフォーマンスに影響しない範囲での漸進再集計でもよい）。**訂正が永久に反映されない集計＝誤読の凍結**を作らない。→ prd/06 §4.1。
- (オプション) 頻出する JSON 項目は MySQL **生成カラム**で昇格してインデックス可能にする。

## マイグレーション
- `pnpm db:migrate` / `pnpm db:seed`。環境変数の実体はコミットしない（`.env.database`）。
