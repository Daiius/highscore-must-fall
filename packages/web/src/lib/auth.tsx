// 認証コンテキスト。起動時に /api/me でセッションを確認し、user を配布する。
// dev ログイン / サインアウト後は refresh() で再取得する。

import { Navigate } from '@tanstack/react-router'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { client, devLogin, signOut } from '../api'

export interface AuthUser {
  id: string
  name: string
  email: string
  image?: string | null
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  refresh: () => Promise<void>
  loginDev: () => Promise<void>
  /** server 側でセッション破棄できたら true。失敗時はローカル状態を維持する。 */
  logout: () => Promise<boolean>
  /** API が 401 を返したときにセッション失効として認証状態を落とす。 */
  clearSession: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await client.api.me.$get()
      const data = (await res.json()) as { user: AuthUser | null }
      setUser(data.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loginDev = useCallback(async () => {
    await devLogin()
    await refresh()
  }, [refresh])

  // server 側でセッション破棄できたときだけローカルの認証状態を落とす
  // （失敗時に cookie が有効なまま UI だけログアウト表示になるのを防ぐ）。成否を返す。
  const logout = useCallback(async () => {
    const ok = await signOut()
    if (ok) setUser(null)
    return ok
  }, [])

  const clearSession = useCallback(() => setUser(null), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <AuthContext.Provider value={{ user, loading, refresh, loginDev, logout, clearSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * 認証必須ページのガード。セッション確認中はプレースホルダ、未ログインなら / へリダイレクト。
 * （MVP は loader ガードではなくコンポーネント境界でガードする。）
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (!user) return <Navigate to="/" />
  return <>{children}</>
}
