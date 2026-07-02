# 02. アーキテクチャ

本章はアプリ全体の技術構成・パッケージ分割・開発環境・依存ポリシー・デプロイ姿勢を定める。
個別の詳細はデータモデル（[03](./03-data-model.md)）・投入（[04](./04-ingestion.md)）・認証（[05](./05-auth-and-privacy.md)）に委ねる。

---

## 1. 全体像

- **フルスタック TypeScript** の **pnpm monorepo**。
- 公開・マルチユーザー前提（[05](./05-auth-and-privacy.md)）。最初は self-host、アクセス増に応じてクラウド移行を検討。
- 設計の中核思想: **`shared`（正規スキーマ＝versioned contract）を単一の真実**とし、
  すべての投入ルート（ファイル/インポート・将来の MCP/API・サーバ側 LLM）と各パッケージがこれを参照する。

```
[ ユーザー自前 LLM / ファイル / (将来)MCP・API / (将来)サーバ側 LLM ]
                     │  すべて同じ正規スキーマ(shared)に収束
                     ▼
   web (UI) ──HTTP/RPC──> server (Hono) ──> database (Drizzle/MySQL)
                                    │
                                    └─> BlobStore（画像: ローカル→将来 R2/S3）
```

## 2. 技術スタック

| 領域 | 採用 | 備考 |
|---|---|---|
| 言語 | TypeScript（ESM, strict） | 全パッケージ共通。`tsconfig.base.json` を extends |
| DB | **MySQL 8.4** | self-host 環境あり |
| ORM | **Drizzle ORM 1.0 RC** | 最新 RC を catalog で exact pin（→ §6） |
| API | **Hono（Hono RPC）** | 型安全な RPC で web と server を接続 |
| 認証 | **better-auth**（Google OAuth） | [05](./05-auth-and-privacy.md) |
| フロント | **Vite + React 19 + TanStack Router** | 型安全ルーティング |
| スタイル | **TailwindCSS（v4）** | 特定デザインなし。仮デザイン→後でゲーム風 |
| 可視化 | **Recharts** | 記述分析のチャート（[06](./06-analysis.md)。MVP 決定 2026-07-03） |
| Lint/Format | **Biome** | 単一ツール。Tailwind クラス整列は `useSortedClasses` |
| テスト | **Vitest**（+ Playwright で E2E） | `shared` の単体テスト重視。UI は Playwright で結線確認 |
| パッケージ管理 | **pnpm**（workspace + catalog） | |
| 開発環境 | **docker compose watch** | bind mount 最小 |

## 3. パッケージ構成（monorepo）

```
packages/
  shared/     # 正規スキーマ(Zod)・TS型/JSON Schema 導出・整合チェック・名寄せ正規化。【単一の真実】
  database/   # Drizzle スキーマ・マイグレーション・DB クライアント・seed
  server/     # Hono(RPC) API・better-auth・ingestion アダプタ層・(将来)MCP
  web/        # Vite + React + TanStack Router + Tailwind の UI
  worker/     # (Phase3) サーバ側 LLM 全自動分析のジョブ処理。MVP は非実装スキャフォルド
```

### 依存方向（循環させない）

```
shared  ← database ← server ← (worker)
   ↑                    │
   └──────── web ───────┘   （web と server は shared に依存。RPC 型も共有）
```

- `shared` は最上流（他に依存しない）。
- `database` を独立させることで、`server`・将来の `worker`・seed スクリプトが循環なく DB 層を共有できる。
- `web` は `shared`（型・JSON Schema）に依存。server とは Hono RPC の型で接続。

### パッケージ名の注意

- ゲーム内でアップグレードを「**contract**」と呼ぶため（[01](./01-game-domain.md) §3）、
  データ契約のパッケージ名に `contract` は**使わない**。責務が凝集しているため `shared` を採用。

## 4. 設計境界（後付けが高コストな3つ）

将来のマルチユーザー化・全自動化・クラウド移行を阻害しないため、MVP 時点で以下の境界だけは正しく引く。

1. **正規スキーマ（contract）= `shared`**: バージョン付き（`schema_version`）。全ルート共通の検証・整合チェックの置き場。
2. **ingestion アダプタ層**: 「ファイル/インポート」「(将来)MCP/API」「(将来)サーバ側 LLM」を差し替え可能にする差し込み口。
   下流（検証→保存）は投入経路を問わず共通（→ [04](./04-ingestion.md)）。
3. **ストレージ抽象**:
   - DB アクセスは `database` に集約（owner_id 境界で分離。→ [03](./03-data-model.md)）。
   - 画像は `BlobStore` インターフェース（§7）でローカル↔クラウドを差し替え可能に。

## 5. 開発環境（docker compose watch）

- ルートの `compose.yaml` で `db` / `server` / `web` を起動。`worker` は `profile: phase3` で隔離（MVP では起動しない）。
- **bind mount を使わず** `docker compose watch` の同期を用いる（参考: 既存リポ `seseraki`）。
  - `server`: `sync+restart`（`packages/server`・`shared`・`database` を同期）。
  - `web`: `sync`（HMR）。
  - `pnpm-lock.yaml` 変更時のみ `rebuild`。
- 画像のローカル保存先（`BlobStore` local）は named volume（`blob-data`）にマウント。
- 主要コマンド（ルート `package.json`）:

| コマンド | 内容 |
|---|---|
| `pnpm dev` | `docker compose watch`（db + server + web） |
| `pnpm typecheck` | 全パッケージ `tsc --noEmit` |
| `pnpm check` / `lint` / `format` | Biome |
| `pnpm test` | Vitest |
| `pnpm db:migrate` / `db:seed` | Drizzle マイグレーション / 初期 seed |

- 環境変数の実体（`.env*`）は**コミットしない**。雛形 `.env.database.example` 等を各自コピーして使う。

## 6. 依存ポリシー

- **pnpm `catalog:`**: 共通依存（React/Hono/Drizzle/Zod 等）のバージョンを `pnpm-workspace.yaml` の `catalog:` に一元化し、
  各 `package.json` は `"x": "catalog:"` で参照する。版ズレ事故を防ぐ。
- **`minimumReleaseAge: 4320`（3日）**: 公開直後の悪意あるリリースを踏みにくくするサプライチェーン対策。
  - 例外: 「最新を即追従したい」依存（**Drizzle 1.0 RC** 等）は catalog で **exact pin** して実質回避する。
- **`onlyBuiltDependencies`**: postinstall ビルドを許可する依存（`esbuild`, `@tailwindcss/oxide` 等）だけ明示。

## 7. ストレージ抽象（`BlobStore`）

画像（run のスクショ証跡）の保存先を抽象化し、self-host → クラウド移行をコード変更最小で行う。

```ts
interface BlobStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>
  getStream(key: string): Promise<ReadableStream>
  delete(key: string): Promise<void>
}
```

- **MVP**: ローカルファイルボリューム実装（compose の named volume）。S3 互換サービスは立てない。
- **移行時**: 同インターフェースを `@aws-sdk/client-s3`（Cloudflare R2 は S3 互換）で実装し差し替え。呼び出し側は無変更。
- **配信は必ずアプリのエンドポイント経由**（直リンク禁止）。`owner_id` 検証を1か所に集約。
  MVP はディスクからストリーム、将来は署名 URL へリダイレクト。詳細は [04](./04-ingestion.md) §画像。

## 8. ツールチェーン詳細

- **Biome**: `biome.json`（ルート）。フォーマット（スペース2/行幅100/シングルクォート/セミコロン必要時のみ）＋ lint。
  - Tailwind クラス整列は `prettier-plugin-tailwindcss` 不可 → Biome **`useSortedClasses`**（nursery）で対応。
- **Git hooks**: **git 2.55+ の config ベース hooks**（`.githooks.gitconfig` + `.githooks/`）。
  `pnpm install`（`prepare` → `.githooks/install.sh`）で `include.path` を冪等設定して有効化。lefthook/husky は不使用（依存ゼロ）。
  - pre-commit: staged ファイルに Biome（依存未導入や git<2.55 では安全にスキップ）。pre-push: `pnpm typecheck`。
  - **前提: git >= 2.55**。
- **型チェック**: 各パッケージ `tsc --noEmit`、ルートで `pnpm -r typecheck`。
- **CI**（将来）: `pnpm check` / `typecheck` / `test`（GitHub Actions 想定。詳細は実装時）。

## 9. デプロイ姿勢

- **self-host で開始**（MySQL・server・web・ローカル `BlobStore`）。アクセス増に応じて Cloudflare / Vercel 等を検討し、
  画像は R2/S3 アダプタへ移行。
- 公開配置の前提: HTTPS / シークレット管理 / CORS /（将来）レート制限（[05](./05-auth-and-privacy.md)）。
- **本番・開発環境の具体情報（ドメイン/TLS/リバプロ/接続先/シークレット）は公開リポジトリに含めない**。
  ローカル限定の運用メモは gitignore 対象の `.claude-personal/` に置き、エージェントからは「存在すれば参照」する。
