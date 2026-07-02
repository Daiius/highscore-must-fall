// Hono の型付きコンテキスト定義と認証ガード。app.ts と各 route モジュールで共有する。
//
//   - Variables: セッションミドルウェアが載せる user / session。
//   - requireUser: 未認証を 401 で弾き、以降のハンドラで owner を保証する。

import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { auth } from './auth'

export type AuthUser = typeof auth.$Infer.Session.user
export type AuthSession = typeof auth.$Infer.Session.session

export type Variables = {
  user: AuthUser | null
  session: AuthSession | null
}

export type AppEnv = { Variables: Variables }

/** 認証必須ルートの前段。未ログインは 401。通過後は c.get('user') が非 null。 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) {
    throw new HTTPException(401, { message: 'authentication required' })
  }
  await next()
}
