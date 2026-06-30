# 02. アーキテクチャ

> **状態: スケルトン**。本文は執筆予定。

## 章立て（予定）

- 技術スタック: MySQL 8.4 / Hono(RPC) / Drizzle 1.0 RC / better-auth / Vite+React19+TanStack Router+Tailwind。
- monorepo パッケージ: `shared` / `database` / `server` / `web` / `worker`(Phase3) と依存関係。
- 設計境界（後付けが高コストな3境界）: ① 中心契約(`shared`) ② ingestion アダプタ層 ③ ストレージ抽象。
- 開発環境: docker compose watch（bind mount 最小、sync/sync+restart、lock 変更時 rebuild）。
- ツールチェーン: Biome（`useSortedClasses`）/ Vitest / `pnpm -r typecheck` / lefthook。
- 依存ポリシー: pnpm `catalog:` 一元管理 / `minimumReleaseAge`(3日) / Drizzle RC は exact pin 例外。
- ストレージ抽象 `BlobStore`: MVP=ローカルボリューム → 将来 R2/S3。配信は認証エンドポイント経由のみ。
- デプロイ姿勢: self-host 開始 → 増えれば CF/Vercel。**本番/開発の具体情報は公開リポに入れない**（`.claude-personal/`）。
