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

## パフォーマンス
- 規模感: 通常1ユーザー内・最大 ~1万 run。**事前集計テーブルは作らない**（素のクエリ→実測で遅ければ導入）。
- (オプション) 頻出する JSON 項目は MySQL **生成カラム**で昇格してインデックス可能にする。

## マイグレーション
- `pnpm db:migrate` / `pnpm db:seed`。環境変数の実体はコミットしない（`.env.database`）。
