# ルール: 正規スキーマ / 契約（`packages/shared`）

`shared` はシステムの**中心契約（versioned contract）**。全投入ルート（ファイル/インポート・将来の MCP/API・サーバ側 LLM）と server/web/worker がこれを参照する。

## 単一の真実
- 正規スキーマは **Zod で定義**し、`shared` に置く。これが唯一の定義元。
- **TS 型は Zod から導出**（`z.infer`）。手書きの重複型を作らない。
- **JSON Schema も Zod から導出**（MCP ツール入力スキーマ・外部ドキュメント・他言語クライアント用）。
- DB スキーマ（`database`）・API バリデーション（`server`）・UI 型（`web`）は、この契約に整合させる。

## バージョニング
- レコードは `schema_version` を持つ。`shared` パッケージは semver。
- 破壊的変更時はバージョンを上げ、**旧→新の変換器**を `shared` に用意する（既存 `raw_payload` を移行可能に）。

## 整合チェック（contract 由来のルール）
- ゲーム内の自明な関係は検証ルールとして `shared` に集約し、**全ルート共通の品質ゲート**にする。
- 既知ルール: `apocalypse_bonus == Σ(reward_ledger.points)`（不一致は確定前 warning → 人間が修正）。
- 検証は「エラー（確定不可）」と「warning（確定可・要確認）」を区別する。

## 名寄せ（正規化）
- アップグレード/リワード名の照合キー生成（大文字化・トリム・記号正規化等）は `shared` のヘルパーに置く。
- カタログは漸進成長（未知名は unverified で自動登録）。詳細は [database.md](./database.md) と PRD 03/04 を参照。

## 投入フォーマット
- 標準は **JSON**。ファイルインポートは **YAML も受理**（内部で同じ Zod 検証に通す）。
