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

/**
 * Google OAuth サインイン開始。better-auth の social sign-in は POST エンドポイントで、
 * 返却される認可 URL へ遷移する（GET リンクでは開始できない）。
 * server で GOOGLE_* が揃っているときのみ機能する。失敗時は例外を投げる。
 */
export async function googleSignIn(callbackURL: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/social`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL }),
  })
  if (!res.ok) throw new Error(`social sign-in の開始に失敗しました (${res.status})`)
  const data = (await res.json()) as { url?: string; redirect?: boolean }
  if (!data.url) throw new Error('認可 URL が返りませんでした（Google 未設定の可能性）')
  window.location.href = data.url
}
