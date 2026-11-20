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
[ ユーザー自前 LLM / ファイル / (将来)MCP・API / スクショ自動解析 ]
                     │  すべて同じ正規スキーマ(shared)に収束
                     ▼
   web (UI) ──HTTP/RPC──> server (Hono) ──> database (Drizzle/MySQL)
                              │  ▲              └─> BlobStore（S3 互換: 本番 R2 / 開発 SeaweedFS）
                              │  │ outbound polling（claim/complete）
                              ▼  │
                     worker（compose 外・分離実行環境）── LLM CLI（画像→構造化）
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
  worker/     # スクショ自動解析のジョブ処理（compose 外・分離実行環境で稼働。prd/04 §9）
  deploy-static/  # web の静的ビルドを配信ディレクトリへ置くデプロイツール（他パッケージに依存しない。§9.2）
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

- ルートの `compose.yaml` で `db` / `server` / `web` / `seaweedfs` を起動。
  **`worker` は compose に含めない**（server とは分離した実行環境で運用する。具体構成は §9 の姿勢に従い
  非公開の運用メモ側に記す。[04](./04-ingestion.md) §9.2）。
- **bind mount を使わず** `docker compose watch` の同期を用いる（参考: 同一スタックの実働リポ）。
  - `server`: `sync+restart`（`packages/server`・`shared`・`database` を同期）。
  - `web`: `sync`（HMR）。
  - `pnpm-lock.yaml` 変更時のみ `rebuild`。
- 画像の開発保存先は **SeaweedFS**（S3 互換ゲートウェイ。named volume。→ §7）。
  local 実装の named volume（`blob-data`）はテスト/フォールバック用に残す。
- 主要コマンド（ルート `package.json`）:

| コマンド | 内容 |
|---|---|
| `pnpm dev` | `docker compose watch`（db + server + web） |
| `pnpm dev:remote` | 同上 ＋ `.env.remote`（リモート dev 公開。→ §5.2） |
| `pnpm typecheck` | 全パッケージ `tsc --noEmit` |
| `pnpm check` / `lint` / `format` | Biome |
| `pnpm test` | Vitest |
| `pnpm db:migrate` / `db:seed` | Drizzle マイグレーション / 初期 seed |

- 環境変数の実体（`.env*`）は**コミットしない**。雛形 `.env.database.example` 等を各自コピーして使う。

### 5.1 同一オリジン配信（dev / 本番で共通の規約）

ブラウザは**常に自分が配信されているオリジンの `/api`** を叩く。`/api` を server へ届けるのは:

- **dev**: web(Vite) の proxy（`DEV_API_TARGET`。compose では `http://server:4000`）
- **本番**: リバースプロキシ（`location /api/ { proxy_pass http://<server>:4000; }`）

**どちらも `/api` を剥がさない**のが規約。better-auth は `BETTER_AUTH_URL` の pathname を受信パスから
剥がしてエンドポイントを解決するため、前段が prefix を剥がすと web 側は prefix 必要／auth 側は prefix 不可で
両立不能になり、`/api/auth/*` が全て 404 になる（2026-07 に踏んだ）。API を**共有ホストの path prefix 配下に
マウントしない**（オリジンのルート直下に置く）。

`VITE_API_BASE_URL` は API を**別オリジン**に置く構成のときだけ設定する（値はオリジンのみ・`/api` を付けない）。
未設定なら `window.location.origin`＝同一オリジン。

### 5.2 リモート dev 公開（`pnpm dev:remote`）

常駐マシン上の dev スタックを、前段プロキシ（TLS 終端＋認証を担うトンネル等）越しに手元ブラウザから
使うための構成。**ローカル dev と compose / vite 設定を分けない**。単一の `compose.yaml` と
`vite.config.ts` を env でパラメータ化し、remote 差分は `.env.remote` だけに集約する
（[`.env.remote.example`](../.env.remote.example)）。差分は次の3つのみ:

| 差分 | ローカル既定 | remote | 効かせ方 |
|---|---|---|---|
| 公開オリジン | なし | `PUBLIC_ORIGIN=https://<host>` | server: better-auth `baseURL` / `trustedOrigins` / CORS<br>web: Vite `allowedHosts` と HMR `wss://<host>:443` |
| web のホスト公開 | `5173`（全 IF） | `127.0.0.1` の1ポート | compose `${WEB_BIND}` |

- **ホストにポートを出すのは web だけ**（db / server / seaweedfs は compose 網内のみ）。前段プロキシは
  その 1 バインドへ向ける。ブラウザも compose 外の worker も、server には web の `/api` proxy 経由で届く（§5.1）。
  他プロジェクトとのポート衝突も避けられる。ホストから直接叩きたいときだけ `compose.override.yaml` で足す。
- https 終端は前段プロキシ。`PUBLIC_ORIGIN` が https なので better-auth は secure cookie を使う。
- **Google OAuth を remote でも使う場合**は、承認済みリダイレクト URI に
  `https://<host>/api/auth/callback/google` を追加する。追加しない場合は dev ログインバイパスで確認する
  （`NODE_ENV=development` 限定。**公開先は必ず前段の認証で保護する**——保護がなければ誰でも
  dev ユーザーとして入れる）。
- 前段プロキシは compose の外で常駐させる。**公開ホスト名・ポート・その具体設定は公開リポに書かない**（§9）。

## 6. 依存ポリシー

- **pnpm `catalog:`**: 共通依存（React/Hono/Drizzle/Zod 等）のバージョンを `pnpm-workspace.yaml` の `catalog:` に一元化し、
  各 `package.json` は `"x": "catalog:"` で参照する。版ズレ事故を防ぐ。
- **`minimumReleaseAge: 4320`（3日）**: 公開直後の悪意あるリリースを踏みにくくするサプライチェーン対策。
  - 例外: 「最新を即追従したい」依存（**Drizzle 1.0 RC** 等）は catalog で **exact pin** して実質回避する。
- **`allowBuilds`**: postinstall ビルドを許可する依存（`esbuild`, `@tailwindcss/oxide` 等）だけ明示（pnpm 11 で `onlyBuiltDependencies` から改名）。

## 7. ストレージ抽象（`BlobStore`）

画像（run のスクショ証跡）の保存先を抽象化し、self-host → クラウド移行をコード変更最小で行う。

```ts
interface BlobStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>
  getStream(key: string): Promise<ReadableStream>
  delete(key: string): Promise<void>
}
```

- 実装は2つ（env `BLOB_STORE` で切り替え。2026-07-06 決定）:
  - **`s3`**: `@aws-sdk/client-s3` による S3 互換アダプタ。**本番 = Cloudflare R2 / 開発 = SeaweedFS**
    （compose に S3 ゲートウェイを追加。endpoint/credentials は env 注入で、R2 との差分は設定のみ）。
  - **`local`**: ローカルファイルボリューム実装。ユニットテストと SeaweedFS を立てない場面のフォールバック。
- **配信は必ずアプリのエンドポイント経由**（直リンク禁止）。`owner_id` 検証を1か所に集約。
  当面はサーバ経由ストリーム、将来は署名 URL へリダイレクト。詳細は [04](./04-ingestion.md) §画像。

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

- **self-host で開始**（MySQL・server・web）。画像は **Cloudflare R2**（S3 アダプタ。§7）。
  アクセス増に応じて Cloudflare / Vercel 等への移行を検討。
- 公開配置の前提: HTTPS / シークレット管理 / CORS /（将来）レート制限（[05](./05-auth-and-privacy.md)）。
- **本番・開発環境の具体情報（ドメイン/TLS/リバプロ/接続先/シークレット）は公開リポジトリに含めない**。
  ローカル限定の運用メモは gitignore 対象の `.claude-personal/` に置き、エージェントからは「存在すれば参照」する。

### 9.1 マイグレーションと seed は本番イメージに同梱する

**適用エントリ（`migrate` / `seed`）を server の本番イメージに入れ、使い捨てコンテナとして実行する。**

- **同梱する理由は、ポートを開けずに済むことではない。**
  → **適用する SQL / カタログとコードのバージョンが、構造的に一致する。**
  外部から流す方式は「**手元にある** SQL を、**本番で動いているイメージ**へ流す」ことになり、
  両者がずれても何も警告されない。同じイメージの中身なら、ずれが原理的に起きない。
- **生成は `drizzle-kit`（dev 専用）、適用は `drizzle-orm` の migrator**（元から本番の実行時依存）。
  本番イメージに `drizzle-kit` は入らない。**資格情報も入らない**（接続先は実行時に env から渡る）。
- **dev も同じエントリを使う**（`pnpm db:migrate` / `db:seed` が `tsx` で同じファイルを叩く）。
  適用経路が 1 本になり、**本番で初めて走らせる経路が無くなる**。
- ⚠ **起動時の自動マイグレーションにはしない。** 失敗時の挙動と、将来インスタンスを増やしたときの
  競合が読めなくなる。**明示的な一手として残す**（compose の `profiles` で通常 `up` から外す）。
- ⚠ **ロールバックは存在しない。** drizzle に down migration は無く、これは適用方式と無関係。
  戻すときは逆 SQL を手で流し、`__drizzle_migrations` の行を消す（DB コンテナには shell と
  mysql クライアントがある）。
- エントリは **`database` パッケージに置く**（`migrate.ts` はパッケージルート直下。`migrationsFolder` を
  ファイル相対で解くため、`src/` に置くと dev とバンドル後で `./drizzle` の位置がずれる）。
  バンドルは `packages/database/esbuild.config.ts`、runtime への配置は `packages/server/Dockerfile.prod`。
- **実行イメージは distroless（Debian 13・Node 24）。** npm もシェルも持たない（`compose exec <service> sh` は使えない）。
  起動の仕方は「ENTRYPOINT を持たず、command を `node` から書く」形（server は CMD の `node server.js`、
  migrate / seed は `command: ["node", "/app/migrate.js"]` / `["node", "/app/seed.js"]`）。
  distroless の既定（ENTRYPOINT が node）に戻すと本番の compose の書き方が変わるので、Dockerfile で
  ENTRYPOINT を空にして `node` を PATH に置いている（テストが照合する）。

### 9.2 web の静的配信は世代を管理して置く

web は Vite の静的ビルド（`index.html` + 内容ハッシュ付きの `assets/`）を配信ディレクトリへ置く。置き方は 2 つある。
どちらも**開きっぱなしのタブを壊さない**ことを同じに守る: 新しい版を置いたあとも、1 つ前の版の `assets/` のファイルを残す
（全部消すと、デプロイ前から開いていたタブが旧チャンクを取りに来て 404 になる。1 つ前まで残せば、次の画面遷移までは動く）。

#### 9.2.1 main に入ると出る（タグの追従。2026-11-20 に有効化）

server（§9.4）と同じ道に乗せる。**状態: 有効（2026-11-20 に有効化）**——本番の VPS が web の `latest` を追いかけている
（有効にするのは所有者。有効になるまでは §9.2.2 で手で出す）。

- 流れ: main への push → [`build-push-web.yml`](../.github/workflows/build-push-web.yml) が、静的ビルドだけを入れたイメージ
  （[`packages/web/Dockerfile.static`](../packages/web/Dockerfile.static)。`FROM scratch` の `/site` に `dist/` の中身）を作り、
  `sha-<40 桁>` だけで push → 別の job が main に突き合わせて `latest` を動かす（考え方は §9.4 の server と同じ）。
  枝の名前のタグは付けない（手動起動で選んだ枝の名前が `latest` などと同じだと、突き合わせを経ずに書き換えるため）。
  手動起動（workflow_dispatch）はどの枝でもでき、その枝の先頭の `sha-<40 桁>` を作るだけで `latest` は動かさない
  → 本番の VPS が `latest` を数分おきに見て、変わっていればイメージを pull し、**起動せずに**中の `/site` を取り出して、
  配信ディレクトリへ新しい「世代」として置き、リンクを切り替える。nginx 越しにページとそれが指す JS・CSS が返ることを確かめ、駄目なら 1 つ前の世代に戻す。
- **開きっぱなしのタブ**: VPS の側が、新しい世代に 1 つ前の世代のファイル（自分のものだけ）も併せて置く。§9.2.2 の「今回と 1 つ前」と同じ性質。
- **版**: イメージは配信される `/version.json`（`{ "commit", "builtAt", "dirty" }`。§9.3 の server と同じ形）と、環境変数 `GIT_COMMIT` を持つ。
  VPS は切り替える前に、両者のコミットが一致することを確かめる。外からは `https://<本番のホスト>/version.json` で確かめる。
  §9.2.2 で置いたビルドは `version.json` を持たない。
- ビルドは手元の `pnpm deploy:web` と同じ `pnpm --filter web build`（`tsc && vite build`）。`VITE_API_BASE_URL` は渡さない（同一オリジン。§5.1）。
  web の `tsc` は API の型（`server/app` → `database`・`shared`）を辿るので、workflow の `paths` は
  `packages/{web,shared,server,database}/**`・根の `pnpm-workspace.yaml` / `package.json` / `pnpm-lock.yaml` / `tsconfig.base.json`・
  根の `.dockerignore`・workflow 自身。server・database だけの変更でも web の世代が進む（JS・CSS は変わらず `version.json` だけが変わる）。
- **時期で使い分ける**: 準備中のあいだ（2026-11-20 まで）は、§9.2.2 の `pnpm deploy:web` で出していた。
- 🔒 **追従を有効にしたあとは `pnpm deploy:web` を使わない（緊急でも）。** VPS の配信ディレクトリは世代へのリンクになっていて、
  手で rsync すると今の世代の中身をその場で書き換える（記録されたイメージと中身・`version.json` が食い違い、次の版が引き継ぐファイルの記録とも合わなくなる）。
  しかも VPS は記録の上では版が合っているとみなすので、**次に main が変わるまで戻らない**。
  緊急で戻したいときは、所有者が VPS で 1 つ前の世代に戻して固定する（server と同じ手順。仕組みの設計は所有者の非公開のリポジトリにある）。
  `pnpm deploy:web` に戻るのは、追従をやめて、配信ディレクトリを実体のディレクトリに戻したあと。`packages/deploy-static` はそのために残す。

#### 9.2.2 手で出す（`pnpm deploy:web`）

追従を有効にするまで（2026-11-20 まで）の出し方。**いまは使わない**（§9.2.1）。本体は `packages/deploy-static`（seseraki の同名パッケージを移植したもの）。接続先は `.env.deploy`
（雛形 `.env.deploy.example`）。**既定は dry-run（計画の表示のみ）で、`--apply` を付けたときだけ書き込む。**

- **`assets/` には「今回」と「1 つ前」のデプロイのファイルだけを残す。** 上書きだけだと古いチャンクが
  溜まり続け、全部消すと開きっぱなしのタブが 404 になる（§9.2 の冒頭）。
- 世代の一覧（`current.txt` / `prev.txt`）は**配信外**のディレクトリに置く。初回（一覧が無い）は何も消さない
  ——前からあったファイルが何者か分からないため。同じビルドの再デプロイでは世代を進めない。
  - 2 回目以降の削除は「今回 ∪ 1 つ前」に無いもの**すべて**が対象で、一覧に載っていないかは問わない。
    一覧を持たない方式（上書きの scp 等）で溜まった古いファイルも、移行後 2 回目のデプロイ
    （ビルドが変わったとき）で消える。手で掃除する必要はない。
- 順序は `pending.txt`（公開しかけた世代）の記録 → `assets/` → `index.html` などトップレベル →
  一覧の更新（`pending.txt` を消す）→ 削除。新しい `index.html` が未着のチャンクを指す瞬間を作らないためで、
  途中で失敗・中断したら以降は行わない。
- `index.html` の公開後に一覧の更新だけが失敗すると、公開済みの世代が一覧に載らない。次回は残った
  `pending.txt` の世代も「1 つ前」に含めて残す。`pending.txt` は上書きせず既存分に今回を足していき、
  一覧の更新に成功したときだけ消す（再試行も失敗したときに、先に公開された世代の記録を失わないため）。
- 接続と転送はシステムの `ssh` / `rsync` を呼ぶ（`~/.ssh/config`・鍵・known_hosts の検証をそのまま効かせる）。
  ControlMaster で接続を 1 本にまとめ、パスフレーズの入力を 1 回で済ませる。
- **`rsync` はローカルだけでなくリモート側にも必要**（リモートに無いと `pending.txt` の記録後、
  最初の rsync 転送が `rsync: command not found` で失敗し、`pending.txt` は残る）。
  リモートのシェルは POSIX sh を前提にする。
- 判断（何を残し何を消すか）は純粋な関数（`plan.ts`）、実行は差し替えられる runner に分けてある。
  テストは本物の ssh を呼ばず、rsync があればローカルの一時ディレクトリで手順を通しで回す。

### 9.3 版の確かめ方（`GET /api/version`）

本番の server がどのコミットから作られたかを、外から確かめられるようにする（デプロイの確認に使う）。

- **`GET /api/version`**（認証なし・DB に触れない）が `{ "commit", "builtAt", "dirty" }` を返す。
  `commit` は 40 桁の SHA、`builtAt` は ISO 8601 の UTC、`dirty` は追跡しているファイルに未コミットの変更が
  ある状態でビルドしたか。**分からない値は文字列 `unknown`**（`dirty` は `false`）にし、ビルドも起動も止めない。
- 値は**イメージのビルド引数**（`GIT_COMMIT` / `BUILD_TIME` / `GIT_DIRTY`）を `Dockerfile.prod` の最終ステージで
  `ENV` に入れたもの（`.dockerignore` が `.git` を除くので、イメージの中では git から取れない）。
  dev（`Dockerfile.dev` と compose）は渡さないので `unknown`。
- **`build-push-server.yml` が渡す**（コミットは `github.sha`・日時は UTC・`dirty` は `false`）。イメージには
  `sha-<40 桁の SHA>` のタグが付く。手元でビルドするときは `--build-arg` を自分で付ける（付けなければ `unknown`）。
- web（静的配信）の版は、配信される `/version.json`（同じ形。Actions で作ったイメージのものだけが持つ。§9.2.1）。

### 9.4 server は main に入ると本番に出る（タグの追従）

**main にマージされた server の変更は、数分で本番に出る**（2026-11-18 から）。

- 流れ: main への push → [`build-push-server.yml`](../.github/workflows/build-push-server.yml) が
  イメージをビルドして `sha-<40 桁>`（と `main`）で push し、そのあとの job が main に突き合わせて `latest` を動かす → 本番の VPS がレジストリの `latest` を数分おきに見て、
  変わっていれば入れ替える → VPS の側で疎通と版（`/api/version` の `commit` がイメージの `GIT_COMMIT` と一致するか）を
  確かめ、駄目なら前のイメージに自動で戻す。動いているが挙動がおかしいときは、所有者が VPS で手で戻す（エージェントは VPS に触らない）。
  デプロイの仕組みの設計は、所有者の非公開のリポジトリにある。
- ビルドが走るのは、`Dockerfile.prod` が読むものに触れた push だけ（workflow の `paths`。
  `packages/{server,shared,database}/**`・根の `pnpm-workspace.yaml` / `package.json` / `pnpm-lock.yaml` /
  `tsconfig.base.json`・根の `.dockerignore`（ビルドの文脈に入るファイルを決める）・workflow 自身）。文書や web・worker だけの変更では本番は入れ替わらない。
- `latest` は、ビルドの job とは別の job「promote」が動かす。この job は**その回のコミットに依らず、その時点の main に突き合わせる**:
  - main を取り直し、main の先頭の workflow から `paths` の一覧を読み、main の first-parent の履歴で `paths` に当たる最後のコミット T を求める
    （merge commit なら、それ自身が T）。`latest` のイメージの `GIT_COMMIT` は、ふつう T（ビルドの入力が変わった最後のコミット）になる
  - T の SHA のタグのイメージがあれば、`latest` をそれに向ける（push 済みのイメージにあとから付ける。作り直さない。既に同じなら何もしない）。
    効く変更と文書を 1 回で push したときは先頭のコミットでしかビルドされないので、T のイメージが無ければ、T から先頭までのコミット
    （入力は T と同じ）のうちイメージのあるものに向ける（打ち切らずに全部を調べる。調べる順は回に依らず新しい方からで、どの回の job も同じ答えになる）
  - どのイメージも無ければ（T のビルドがまだ終わっていない・失敗した）何もしない。T の回が終われば、その回の job が付ける。
    T のビルドが失敗していれば `latest` は前の版のままで、Summary に「T のイメージがまだ無い」と出る。T の回を再実行すれば付く
  - 突き合わせられないとき（main を取れない・履歴が浅い・`paths` の一覧を読めない・レジストリを確かめられない）は、動かさずに失敗で終わる
  - この job は固定の group で直列に走る（判定と付与の間に、別の回の付与が割り込まない）。どの回のこの job も同じ突き合わせをするので、
    古い回の再実行でも `latest` は戻らず、待っていた回が取り消されても、生き残った回がより新しい main で同じ突き合わせをする。
    ビルドの job は並んで走ってよい（同じコミットの重複だけ直列）。main 以外の枝の回では、この job は走らない
  - `paths` の一覧は workflow の起動条件の 1 か所だけにあり、job「promote」は main の先頭のそれを読む
- 🔒 **順序を守るのは、マージする人とエージェント。** 仕組みの側にマイグレーションで止める関所は無い。
  - マイグレーション・環境変数の追加・手作業の後処理を伴う PR は、マージの前に所有者と段取りを決める。エージェントは勝手にマージしない。
  - マイグレーションは**古い server でも動く形（足すだけ）**にし、**先に本番へ流してからマージする**（§9.1。
    同梱の `migrate.js` で流すには、そのマイグレーションを含むイメージが先に要る。PR の枝で workflow を手動起動すれば、
    `latest` を動かさずに `sha-<40 桁>` のイメージができる。どう流すかは所有者と決める）。
    ⚠ ロールバックで server を戻しても、スキーマは戻らない（§9.1）。戻した server が新しいスキーマで動けることが前提になる。
- worker は対象外。今までどおり手で出す。web（静的配信）も同じ形に乗せた（2026-11-20。§9.2.1）。
