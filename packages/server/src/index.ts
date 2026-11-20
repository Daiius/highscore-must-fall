// server のエントリポイント。Hono アプリを @hono/node-server で起動する。
// ルート定義・認証・RPC 型は ./app に集約している。

import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { client } from 'database'
import { app } from './app'
import { createGracefulShutdown } from './lib/graceful-shutdown'

const port = Number(process.env.PORT ?? 4000)

// 停止の合図で、処理中のリクエスト（ハンドラと応答の書き出し）を終えてから DB のプールを閉じて終了する。
// `client` は mysql2 の callback 版の Pool で `end()` は void を返すので、callback を Promise に包む。
// database の `shutdown()`（src/shutdown.ts）は自分で exit する一発限りの CLI 用なので使わない
const shutdown = createGracefulShutdown({
  closers: [
    {
      name: 'db',
      close: () =>
        new Promise<void>((resolve, reject) =>
          client.end((error) => (error ? reject(error) : resolve())),
        ),
    },
  ],
})

// `createServer` を渡していないので node:http の Server（戻り値の型は http2 との合併なので絞る）
const server = serve({ fetch: shutdown.track(app.fetch), port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`)
}) as Server
shutdown.install(server)
