// API クライアント。server の Hono RPC 型（AppType）で型付けする。
// 認証は cookie セッション（better-auth）なので credentials: 'include' を常に付ける。
// dev ログイン / サインアウトは RPC チェーン外なので素の fetch で叩く。

import { hc } from 'hono/client'
import type { AppType } from 'server/app'

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

export const client = hc<AppType>(baseUrl, {
  init: { credentials: 'include' },
})

export const API_BASE_URL = baseUrl

/** dev ログインバイパス（NODE_ENV=development の server のみ）。 */
export async function devLogin(): Promise<boolean> {
  const res = await fetch(`${baseUrl}/api/dev/login`, {
    method: 'POST',
    credentials: 'include',
  })
  return res.ok
}

/** better-auth サインアウト。 */
export async function signOut(): Promise<void> {
  await fetch(`${baseUrl}/api/auth/sign-out`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
}

/** Google OAuth サインイン導線（server で GOOGLE_* が揃っているときのみ機能）。 */
export function googleSignInUrl(callbackURL: string): string {
  // better-auth の social sign-in はエンドポイント経由。ここでは簡易にリダイレクト用 URL を返す。
  return `${baseUrl}/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(callbackURL)}`
}
