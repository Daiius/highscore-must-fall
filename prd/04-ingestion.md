# 04. 投入（ingestion）

> **状態: スケルトン**。本文は執筆予定。

## 章立て（予定）

- 設計思想: 全ルートが正規スキーマ（`shared`）に収束。LLM 解析はアダプタとして差し替え可能。
- ルート一覧:
  - 段階1（**MVP**）: ユーザー自前 LLM で外部解析 → JSON/YAML をファイル/貼り付け投入。スクショは証跡として保存（処理はしない）。
  - 段階2（Phase2, 副産物）: API（トークン認証、同一スキーマ）。
  - 段階3（Phase2 設計/接続口、本命）: MCP サーバ（`submit_run` / `get_extraction_guide` / `list_catalog`）。
  - 全自動（Phase3）: サーバ側 LLM が画像→構造化（worker）。
- レビュー&検証層: Zod 検証 + 整合チェック → 不一致は warning でインライン表示 → 人間が修正 → 確定。部分ドラフト許容。
- 分析キット配布画面: 現行 schema_version の JSON Schema + 抽出手順プロンプト + 既知カタログ。
- 画像アップロード: section ごと（MVP は各1枚, 最大3枚）/ 制約(png,jpeg,webp / 10MB) / EXIF 除去 / 認証配信。
- schema_version とバージョン互換。
