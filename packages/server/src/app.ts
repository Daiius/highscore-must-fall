// Hono アプリ本体（RPC 型導出のため route を束ねて AppType を export する）。
//
//   - CORS は web オリジンのみ許可（credentials 有効）。
//   - /api/auth/* は better-auth ハンドラに委譲。
//   - セッションをコンテキストに載せるミドルウェア（c.get('user') / c.get('session')）。
//   - dev ログインバイパス /api/dev/login（本番では未登録）。
//   - ingestion（検証・分析キット配布）と run 保存を route モジュールとして mount。
//   - 動作確認用の /api/health / /api/me。
//
// 後続 PR で run 一覧/詳細・catalog・画像配信のルートをこの route チェーンに足していく。

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth, isDevLoginEnabled, webOrigin } from './lib/auth'
import type { AppEnv } from './lib/context'
import { catalogRoute } from './routes/catalog'
import { ingestRoute } from './routes/ingest'
import { runsRoute } from './routes/runs'

export const app = new Hono<AppEnv>()

app.use(
  '*',
  cors({
    origin: webOrigin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

// セッションをコンテキストに載せる。/api/auth/* 自身は better-auth が cookie を処理するので
// ここでの取得は不要（二重取得を避ける）。
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) {
    return next()
  }
  const s = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('user', s?.user ?? null)
  c.set('session', s?.session ?? null)
  await next()
})

// better-auth のエンドポイント（サインイン/コールバック/サインアウト等）。
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// dev ログインバイパス（本番では未登録）。シード済み dev ユーザーにサインインして
// better-auth の実セッション cookie を返す。実 Google クレデンシャル無しで E2E を通すため。
if (isDevLoginEnabled) {
  app.post('/api/dev/login', async () => {
    const credentials = {
      email: 'dev@example.com',
      password: 'dev-password-1234',
      name: 'Dev User',
    }
    // 初回のみ作成（既存なら 4xx を握りつぶしてサインインへフォールスルー）。
    try {
      await auth.api.signUpEmail({ body: credentials })
    } catch {
      // 既存ユーザー。
    }
    return auth.api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
      asResponse: true,
    })
  })
}

const route = app
  .get('/api/health', (c) => c.json({ ok: true }))
  .get('/api/me', (c) => c.json({ user: c.get('user') }))
  .route('/api/ingest', ingestRoute)
  .route('/api/runs', runsRoute)
  .route('/api/catalog', catalogRoute)

/** RPC 型（web の hono/client から参照する）。 */
export type AppType = typeof route

export { hc } from 'hono/client'
