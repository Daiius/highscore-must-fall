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
- **記述分析**: スコア散布図 / アップグレード取得タイムライン（系統構成・アップグレード別。[06](./06-analysis.md) §1.2）。
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

## 確定事項（旧「未確定・要確認」）

以下は詰め終わった。残る恒常課題は「網羅性」のみ（unverified 自動登録で漸進対応）。

- ✅ カタログの所有: **グローバル**で確定（2026-07-02。[03](./03-data-model.md) §5）。
- ✅ 「1週間 = 7日」で確定（[01](./01-game-domain.md) §2: WEEK1=1〜7日 / WEEK2=8〜10日）。
- ✅ 正規化キー生成ルール確定（ASCII フォールディング＋空白保持＋大文字化・記号保持。[.claude/rules/schema-and-contract.md](../.claude/rules/schema-and-contract.md) §名寄せ）。
- ✅ グラフ可視化ライブラリ: **Recharts**（2026-07-03。記述分析の棒/折れ線/分布に使用）。
- ✅ 配置/設定つき upgrade の手動メモ欄: **Phase2 送り**（[01](./01-game-domain.md) §9）。
- ✅ 1 section 複数スクショ: **MVP は1枚固定**（[01](./01-game-domain.md) §9・[04](./04-ingestion.md) §7）。
- ✅ CI: **GitHub Actions** で `pnpm check` / `pnpm typecheck` / `pnpm test`（本リポの `.github/workflows/ci.yml`）。
- ⏳ **恒常課題**: 結果指標・カタログの網羅性（サンプル外項目）→ unverified 自動登録＋人手 verify で漸進対応。
