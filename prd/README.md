# PRD: Highscore Must Fall

> **状態: スケルトン（章立てのみ）**。各文書の本文は順次執筆する。
> 仕様策定の全決定ログは [`_grilling/decisions.md`](./_grilling/decisions.md)。

## 目的

Utopia Must Fall のプレイ結果（スコア / アップグレード取得履歴 / リワード）を記録し、
「どのアップグレードをどのタイミングで取ったか」「ハイスコアの傾向」を分析する。公開・マルチユーザー前提。

## スコープ

- **MVP**: OAuth ログイン → ユーザー自前 LLM で外部解析した JSON/YAML を投入（スクショは証跡として保存）→
  レビュー&整合チェック → 確定 → run 閲覧・最小カタログ管理・記述的分析。
- **スクショ自動解析（Phase3 から前倒し・進行中）**: 画像アップロード → worker（サーバ側 LLM）が
  構造化 → 厳格ゲート通過で自動確定。admin（将来は課金ユーザー）限定（[04](./04-ingestion.md) §9）。
- **Phase2**: MCP/API 投入、相関分析。
- **Phase3**: 課金、横断統計/ランキング（オプトイン）。
- 詳細フェーズ: [07-roadmap.md](./07-roadmap.md)。

## アーキ概観

- フルスタック TypeScript の pnpm monorepo: `shared` / `database` / `server` / `web` / `worker`
  （worker はスクショ自動解析。compose 外・分離実行環境）。
- MySQL 8.4 / Hono(RPC) / Drizzle 1.0 RC / better-auth(Google) / Vite+React19+TanStack Router+Tailwind。
- docker compose watch / Biome / Vitest。
- 設計の柱: **`shared` を中心契約（Zod 単一真実）**にして全投入ルートを収束させる。

## 文書索引

1. [01-game-domain.md](./01-game-domain.md) — ゲームのドメイン事実
2. [02-architecture.md](./02-architecture.md) — 技術スタック / 構成 / 開発環境 / 依存ポリシー
3. [03-data-model.md](./03-data-model.md) — 正規スキーマ / DB / インデックス / 整合チェック
4. [04-ingestion.md](./04-ingestion.md) — 投入ルート / アダプタ / レビュー / 分析キット
5. [05-auth-and-privacy.md](./05-auth-and-privacy.md) — 認証 / プライバシー
6. [06-analysis.md](./06-analysis.md) — 分析機能
7. [07-roadmap.md](./07-roadmap.md) — フェーズ分け
8. [08-catalog-lifecycle.md](./08-catalog-lifecycle.md) — カタログの verify 手続き / 孤児掃除 / 管理 UI のスコープ
