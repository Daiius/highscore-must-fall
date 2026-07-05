# AGENTS.md

> このファイルがリポジトリの**正典**です（使用する各コーディングエージェント共通）。簡潔・リンク中心に保つこと。
> 詳細仕様は [`prd/`](./prd/)、コーディング規約は [`.claude/rules/`](./.claude/rules/) を参照。

## プロジェクト目的

**Utopia Must Fall**（ウェーブ防衛系ローグライト・アーケード）のプレイ結果を記録し、
「どのアップグレードをどのタイミングで取ったか」「ハイスコアの傾向」を分析するアプリ。
公開・マルチユーザー前提。→ 詳細は [`prd/README.md`](./prd/README.md)。

## ドキュメント（PRD）

| 文書 | 内容 |
|---|---|
| [prd/README.md](./prd/README.md) | 目的 / スコープ(MVP vs Phase2) / アーキ概観 / 索引 |
| [prd/01-game-domain.md](./prd/01-game-domain.md) | ゲームのドメイン事実（週 / contract=アップグレード / リロール / apocalypse_bonus / サンプル / 初期カタログ） |
| [prd/02-architecture.md](./prd/02-architecture.md) | 技術スタック / monorepo / 開発環境 / 依存ポリシー / デプロイ姿勢 |
| [prd/03-data-model.md](./prd/03-data-model.md) | 正規スキーマ / DB テーブル / インデックス / 整合チェック |
| [prd/04-ingestion.md](./prd/04-ingestion.md) | 複数投入ルート / アダプタ層 / レビュー&検証 / 分析キット配布 |
| [prd/05-auth-and-privacy.md](./prd/05-auth-and-privacy.md) | better-auth / OAuth / プライバシー |
| [prd/06-analysis.md](./prd/06-analysis.md) | MVP 記述分析 / Phase2 相関分析 |
| [prd/07-roadmap.md](./prd/07-roadmap.md) | フェーズ分け |

> 仕様策定の経緯（grill ログ）: [`prd/_grilling/decisions.md`](./prd/_grilling/decisions.md)

## 技術スタック / 構成

- フルスタック TypeScript の **pnpm monorepo**。
- **DB**: MySQL 8.4 / **API**: Hono(RPC) / **ORM**: Drizzle ORM 1.0 RC / **Auth**: better-auth(Google OAuth)
- **Front**: Vite + React 19 + TanStack Router + TailwindCSS
- **開発環境**: docker compose watch（bind mount 最小）/ **Lint+Format**: Biome / **Test**: Vitest
- **Git hooks**: git 2.55+ の config ベース hooks（`.githooks.gitconfig` + `.githooks/`、`pnpm install` で有効化）。**git >= 2.55 前提**。

### パッケージ

| パッケージ | 役割 |
|---|---|
| [`packages/shared`](./packages/shared) | 正規スキーマ(Zod)・TS型/JSON Schema 導出・整合チェック・名寄せ正規化。**単一の真実** |
| [`packages/database`](./packages/database) | Drizzle スキーマ・マイグレーション・DB クライアント・seed |
| [`packages/server`](./packages/server) | Hono(RPC) API・better-auth・ingestion アダプタ・(将来)MCP |
| [`packages/web`](./packages/web) | Vite + React + TanStack Router + Tailwind の UI |
| [`packages/worker`](./packages/worker) | スクショ自動解析のジョブ処理。**compose 外・server と分離した実行環境で稼働**（prd/04 §9。具体構成は `.claude-personal/` の運用メモ） |

## 開発コマンド

```bash
pnpm dev          # docker compose watch（db + server + web を起動・同期）
pnpm typecheck    # 全パッケージ tsc --noEmit
pnpm lint         # Biome lint
pnpm format       # Biome format
pnpm test         # Vitest
pnpm db:migrate   # Drizzle マイグレーション適用
pnpm db:seed      # 初期カタログ等のシード投入
```

> 注: 環境変数の実体（`.env*`）はコミットしない。雛形は `*.env.example` を参照。

## コーディング規約（[.claude/rules/](./.claude/rules/)）

- [typescript.md](./.claude/rules/typescript.md) — TS / 命名 / Biome（Tailwind クラス整列は `useSortedClasses`）
- [schema-and-contract.md](./.claude/rules/schema-and-contract.md) — `shared` の Zod を単一真実に、JSON Schema 導出、`schema_version` 規約
- [database.md](./.claude/rules/database.md) — Drizzle / `owner_id` 必須 / インデックス方針 / `raw_payload` 分離
- [commit.md](./.claude/rules/commit.md) — コミット / PR 規約（PR は [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) / `/create-draft-pr` スキル）

## ローカル専用メモ（任意）

`.claude-personal/`（gitignore 対象）が**存在する場合は**、その中のファイルも参照してよい。
リポジトリに残したくないローカル限定のルール・運用情報をそこに置く。

- **作業の続き**: `.claude-personal/TASKS.md` が**あれば、セッション開始時に必ず読む**（次にやること・要確認事項の記録）。
