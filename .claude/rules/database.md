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
- `upgrade_catalog` / `reward_catalog`: 正規キー・表示名・`unverified` フラグ・エイリアス。漸進成長。
- 初期 seed = サンプル由来のみ（upgrade 16種 / reward 13種）。リロール名（DIGITIZE CONSCIOUSNESS 等）は **upgrade に入れない**。
- **種別 `kind`**（`upgrade_catalog` のみ）: `contract`（既定） / `opportunity_upgrade`(OU)。OU はラン跨ぎ恒久解禁のメタ進行だが、UPGRADE HISTORY 上は通常アップグレードと同様に色付きで載る（例 `CONTEXT SWITCH`）。**記録は通常アップグレードと同じ**（`entry_type` に第3種は足さない）。`kind` は `unverified` 同様、後から人手で付与/検証する「一応後から区別できる」程度の属性。
- **`reward_catalog` は run 内 reward（ゲーム内 "performance bonus" = `apocalypse_bonus` の内訳）のプール**。**Steam 実績(31個)とは別系統**（名前が一部重複するだけ。実績 `Schadenfreude` の定義が両レイヤーの別物性を裏付ける）。**Steam 実績名を seed / カタログに混入させない**。プールは run スクショ投入で unverified 自動登録して育てる。
- **リロール(Citizen Proposals)は手書きの有限固定プール**（CHANGELOG が個数を数えて手動追加）だが、**カタログには登録しない**（`entry_type=reroll` で位置・回数のみ集計、フレーバーは任意で verbatim 保存）。完全な原文名リストは Web に無く、スクショが唯一の一次情報。

## パフォーマンス
- 規模感: 通常1ユーザー内・最大 ~1万 run。**事前集計テーブルは作らない**（素のクエリ→実測で遅ければ導入）。
- (オプション) 頻出する JSON 項目は MySQL **生成カラム**で昇格してインデックス可能にする。

## マイグレーション
- `pnpm db:migrate` / `pnpm db:seed`。環境変数の実体はコミットしない（`.env.database`）。
