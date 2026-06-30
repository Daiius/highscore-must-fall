# 03. データモデル

> **状態: スケルトン**。本文は執筆予定。

## 章立て（予定）

- 正規スキーマ（`shared` の Zod）: run レコードの構造、`schema_version`。
- run 保存（ハイブリッド）: 型付きコアカラム + `raw_payload`(JSON, ホット行から分離) + 来歴メタ。
- 正規化テーブル:
  - `upgrade_entry`: `entry_type`(`upgrade`|`reroll`) / 週 / 週内取得順 / (`upgrade`のみ)catalog 紐付け / アップグレードのみ通し番号の導出。
  - `reward_entry`: name(catalog 紐付け) / count / points。
- カタログ: `upgrade_catalog` / `reward_catalog`（正規キー・表示名・unverified・エイリアス、漸進成長）。初期 seed。
- 画像: `run_image`（owner_id / run_id / section / storage_key / content_type / byte_size / 任意 width,height）。
- 認証テーブル: better-auth が管理（user / session / account 等）。
- マルチテナント: 全テーブル `owner_id`、複合インデックス先頭に owner_id。
- インデックス方針: `(owner_id, played_at)` / `(owner_id, final_score)` / `upgrade_entry(run_id)` / `(upgrade_catalog_id, week_index)`。
- 整合チェック: `apocalypse_bonus == Σ(reward.points)`（error/warning の区別）。
- パフォーマンス: ~1万 run 規模、事前集計なし、(オプション)生成カラム。
