// Hono の型付きコンテキスト定義と認証ガード。app.ts と各 route モジュールで共有する。
//
//   - Variables: セッションミドルウェアが載せる user / session。
//   - requireUser: 未認証を 401 で弾き、以降のハンドラで owner を保証する。

import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
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

/**
 * 管理者限定ルートの前段（スクショ自動解析の機能ゲート。prd/05 §6）。
 * 未ログインは 401、非 admin は 403。将来の課金ユーザーはここの判定に足す。
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user')
  if (!user) {
    throw new HTTPException(401, { message: 'authentication required' })
  }
  if (user.role !== 'admin') {
    throw new HTTPException(403, { message: 'admin only' })
  }
  await next()
}

/** ingestion 系 POST の本文サイズ上限（2MB）。1 run の JSON/YAML は数 KB で十分。 */
export const MAX_INGEST_BODY_BYTES = 2 * 1024 * 1024

/** 巨大リクエストをパース前に 413 で弾く（DoS・DB 過大保存の一次防御）。 */
export const limitIngestBody = bodyLimit({
  maxSize: MAX_INGEST_BODY_BYTES,
  onError: (c) =>
    c.json(
      {
        ok: false,
        issues: [
          { level: 'error', code: 'body_too_large', message: 'リクエストが大きすぎます', path: [] },
        ],
      },
      413,
    ),
})
