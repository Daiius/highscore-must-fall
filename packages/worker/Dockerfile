# worker のコンテナイメージ。
#
# worker は **server とは分離した実行環境**で動かす（prd/04 §9.2）。この Dockerfile は
# その実行環境をコンテナで用意するためのもので、リポジトリの compose.yaml（db/server/web）
# には含めない。常駐させる compose は運用側に置く（具体構成は非公開の運用メモ）。
#
# LLM CLI はイメージに含めない。使用する CLI は env のコマンドテンプレートで注入する方針
# （公開リポにツール固有名を置かない。prd/04 §9.2）なので、実行環境側が CLI 本体と
# その認証をコンテナへ与える（マウント等）。
#
# server と同様のバンドルはせず tsx で TS を直接実行する（worker は常駐 1 プロセスで、
# 起動時間もイメージサイズも支配的でない）。

FROM node:22-slim

# ca-certificates: LLM CLI は OS の CA ストアで TLS を検証する（Node は自前の CA バンドルを持つので
#   polling は通るが、CLI 側だけが UnknownIssuer で落ちる）。node:22-slim には入っていない。
# bubblewrap: CLI が自前のサンドボックスでツール実行を隔離する場合に使う。無くても同梱版に
#   フォールバックするが、毎回警告が出るので OS のものを入れる。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates bubblewrap \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /workspace

# 依存解決に必要なマニフェスト類を先にコピー（レイヤキャッシュを効かせる）。
# catalog: 参照の解決に pnpm-workspace.yaml が必須。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json   packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/server/package.json   packages/server/package.json
COPY packages/worker/package.json   packages/worker/package.json
# pnpm の prepare フック（.githooks/install.sh）が install 時に呼ばれる。
# git 管理外では自身で exit 0 するが、ファイルが無いと sh が開けず落ちるため先にコピーする。
COPY .githooks .githooks

# worker とその依存だけを解決する（web は入れない）。
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter worker...

# worker が実行時に読むソース。server は型のみの依存（Hono RPC の AppType）で、
# tsx は型注釈を落として実行するため実体は要らないが、workspace 依存として解決に必要。
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/worker packages/worker

CMD ["pnpm", "--filter", "worker", "daemon"]
