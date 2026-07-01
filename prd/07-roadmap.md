# 07. ロードマップ

各章の決定をフェーズに整理する。MVP は「確実に取り込め・閲覧でき・記述分析で眺められる」ループの完成を目標とする。

---

## MVP

**目的**: データ投入ループの完成と記述的分析。self-host・private。

- **認証**: better-auth + Google OAuth（[05](./05-auth-and-privacy.md)）。private データのみ。
- **投入（段階1）**: ファイル/貼り付けインポート（ユーザー自前 LLM の JSON/YAML）。分析キット配布画面（[04](./04-ingestion.md)）。
- **検証/レビュー**: `shared` の Zod + 整合チェック（`apocalypse_bonus == Σreward.points`）。warning 表示・ドラフト保存・確定。
- **画像**: スクショ証跡の添付・保存（各画面1枚・最大3枚、`BlobStore` ローカル、認証配信）。
- **閲覧**: run 一覧/詳細、自己ベスト・自分の run 内ランキング。
- **記述分析**: スコア推移 / アップグレード頻度（全体・週別）/ 取得タイミング分布。
- **カタログ管理（最小）**: 未検証一覧・verify・マージ。
- **基盤**: monorepo（shared/database/server/web）、MySQL、docker compose watch、Biome/Vitest、git 2.55+ hooks。

## Phase2

**目的**: 投入ルートの拡張と本命の相関分析。必要ならクラウド移行。

- **MCP**: `submit_run` / `get_extraction_guide` / `list_catalog`（[04](./04-ingestion.md) §8）。
- **API**: トークン認証の HTTP 投入。
- **相関分析**: アップグレード×タイミング→スコア、リロール×スコア、リワード分析（[06](./06-analysis.md) §2）。
- **カタログのリッチ属性**: カテゴリ・色・レアリティ。
- **クラウド移行（必要に応じて）**: Cloudflare/Vercel、画像は R2/S3 アダプタへ。

## Phase3

**目的**: 全自動化・収益化・コミュニティ統計。

- **サーバ側 LLM 全自動分析**: `worker` が画像→構造化（[04](./04-ingestion.md) §9）。
- **課金**: 有料（全自動）。
- **横断統計 / ランキング**: オプトイン前提・自己申告スコアの信頼性対策（[05](./05-auth-and-privacy.md) §4）。
- データモデルに「集計利用同意フラグ」を追加。

## 未確定・要確認（実装前に詰める）

- カタログの所有: **グローバル** vs owner ごと（[03](./03-data-model.md) §5 で暫定グローバル。要確認）。
- 「1週間 = 7日」の確定（[01](./01-game-domain.md) §2 は推定）。
- 結果指標・カタログの網羅性（サンプル外項目）。
- catalog の正規化キー生成の具体ルール（記号・アポストロフィ `CHEF'S KISS` 等の扱い）。
- グラフ可視化ライブラリの選定。
- CI（GitHub Actions）の具体。
