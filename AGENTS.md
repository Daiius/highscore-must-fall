# AGENTS.md

> このファイルがリポジトリの**正典**です（使用する各コーディングエージェント共通）。簡潔・リンク中心に保つこと。
> 詳細仕様は [`prd/`](./prd/)、コーディング規約は [`.claude/rules/`](./.claude/rules/) を参照。

## ⚠ main に入ると server（と web）は数分で本番に出る（マージの前に必ず読む）

- **server は、main にマージされると数分で本番に出る。** main への push で server のイメージがビルドされ
  （[`build-push-server.yml`](./.github/workflows/build-push-server.yml)。`paths` に当たる変更のとき）、
  本番の VPS がレジストリの `latest` を数分おきに見て、変わっていれば自動で入れ替える。
  **「マージしても本番には出ない」と考えない。** 出したくない変更は main に入れない。
- **web（静的配信）も同じ形にする**（[`build-push-web.yml`](./.github/workflows/build-push-web.yml)。静的ビルドだけを入れたイメージを作り、
  VPS が中身を配信ディレクトリへ世代として取り出す。prd/02 §9.2）。
  **状態: 準備中**（workflow はあるが、VPS はまだ web の `latest` を追いかけていない。有効にするのは所有者）。
  有効になるまでは、main に入っても web は本番に出ない（今までどおり所有者が手で出す）。
  有効になったあとは、web の変更も server と同じく数分で本番に出る。
- **worker は対象外**で、今までどおり所有者が手で出す。
- 🔒 **次の PR は、マージの前に所有者と段取りを決める。エージェントは勝手にマージしない。**
  - マイグレーション（`packages/database` のスキーマや `drizzle/` の変更）を伴う
  - 環境変数の追加・変更を伴う（本番の env は所有者が置く）
  - デプロイの前後に手作業（データの後処理・seed の再投入など）が要る
- マイグレーションは**古い server でも動く形（足すだけ）**にし、**先に本番へ流してからマージする**。
  マージすると新しい server が先に出るため、順序が逆だと新しい server が古いスキーマの上で動く。
  切り戻したときも、戻した server が新しいスキーマの上で動けるようにしておく。
- 本番の版は `GET /api/version` の `commit` で確かめる（[prd/02](./prd/02-architecture.md) §9.3）。web は配信される `/version.json`（Actions で作ったものだけが持つ）。
  **おかしいときの戻し方（VPS での切り戻し）は所有者の作業。エージェントは VPS に触らない。**
- 詳細は [prd/02](./prd/02-architecture.md) §9.4（web は §9.2）。デプロイの仕組みの設計は、所有者の非公開のリポジトリにある。

## プロジェクト目的

**Utopia Must Fall**（ウェーブ防衛系ローグライト・アーケード）のプレイ結果を記録し、
「どのアップグレードをどのタイミングで取ったか」「ハイスコアの傾向」を分析するアプリ。
公開・マルチユーザー前提。→ 詳細は [`prd/README.md`](./prd/README.md)。

## ドキュメント（PRD）

| 文書 | 内容 |
|---|---|
| [prd/README.md](./prd/README.md) | 目的 / スコープ(MVP vs Phase2) / アーキ概観 / 索引 |
| [prd/01-game-domain.md](./prd/01-game-domain.md) | ゲームのドメイン事実（週 / contract=アップグレード / リロール / apocalypse_bonus / サンプル / 初期カタログ） |
| [prd/02-architecture.md](./prd/02-architecture.md) | 技術スタック / monorepo / 開発環境 / 依存ポリシー / デプロイ姿勢（server は main で自動。§9.4） |
| [prd/03-data-model.md](./prd/03-data-model.md) | 正規スキーマ / DB テーブル / インデックス / 整合チェック |
| [prd/04-ingestion.md](./prd/04-ingestion.md) | 複数投入ルート / アダプタ層 / レビュー&検証 / 分析キット配布 |
| [prd/05-auth-and-privacy.md](./prd/05-auth-and-privacy.md) | better-auth / OAuth / プライバシー |
| [prd/06-analysis.md](./prd/06-analysis.md) | MVP 記述分析 / Phase2 相関分析 |
| [prd/07-roadmap.md](./prd/07-roadmap.md) | フェーズ分け |
| [prd/08-catalog-lifecycle.md](./prd/08-catalog-lifecycle.md) | カタログの verify 手続き / evidence / 孤児掃除 / 管理 UI のスコープ / bot 誤読への対処 |

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
| [`packages/deploy-static`](./packages/deploy-static) | web の静的ビルドを配信先へ置く手元のデプロイツール。`assets/` は今回と 1 つ前の世代だけ残す。追従を有効にしたあとは緊急用（prd/02 §9.2） |
| [`packages/worker`](./packages/worker) | スクショ自動解析のジョブ処理。**server と分離した実行環境で稼働**（開発用 compose 外。コンテナ用イメージは `packages/worker/Dockerfile`、起動する compose は運用側。prd/04 §9。具体構成は `.claude-personal/` の運用メモ） |

## 開発コマンド

```bash
pnpm dev          # docker compose watch（db + server + web を起動・同期）
pnpm dev:remote   # 同上 + .env.remote（リモート dev 公開。prd/02 §5.2。:logs / :down あり）
pnpm typecheck    # 全パッケージ tsc --noEmit
pnpm lint         # Biome lint
pnpm format       # Biome format
pnpm test         # Vitest
pnpm db:migrate   # Drizzle マイグレーション適用（本番イメージにも同じエントリを同梱。prd/02 §9.1）
pnpm db:seed      # 初期カタログ等のシード投入（冪等）
pnpm deploy:web   # web をビルドして配信先へ（既定 dry-run、--apply で反映。接続先は .env.deploy。追従の有効後は緊急用。prd/02 §9.2）
```

> 注: 環境変数の実体（`.env*`）はコミットしない。雛形は `*.env.example` を参照。

## コーディング規約（[.claude/rules/](./.claude/rules/)）

- [typescript.md](./.claude/rules/typescript.md) — TS / 命名 / Biome（Tailwind クラス整列は `useSortedClasses`）
- [react.md](./.claude/rules/react.md) — React Compiler にメモ化を任せる（`useMemo`/`useCallback` を書かない）／コンポーネントに `try/catch` を書かず `Result` で返す
- [schema-and-contract.md](./.claude/rules/schema-and-contract.md) — `shared` の Zod を単一真実に、JSON Schema 導出、`schema_version` 規約
- [database.md](./.claude/rules/database.md) — Drizzle / `owner_id` 必須 / インデックス方針 / `raw_payload` 分離
- [commit.md](./.claude/rules/commit.md) — コミット / PR 規約（PR は [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) / `/create-draft-pr` スキル）

## ローカル専用メモ（任意）

`.claude-personal/`（gitignore 対象）が**存在する場合は**、その中のファイルも参照してよい。
リポジトリに残したくないローカル限定のルール・運用情報をそこに置く。

- **作業の続き**: `.claude-personal/TASKS.md` が**あれば、セッション開始時に必ず読む**（次にやること・要確認事項の記録）。
