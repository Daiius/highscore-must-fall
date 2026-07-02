// server のエントリポイント。Hono アプリを @hono/node-server で起動する。
// ルート定義・認証・RPC 型は ./app に集約している。

import { serve } from '@hono/node-server'
import { app } from './app'

const port = Number(process.env.PORT ?? 4000)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`)
})
