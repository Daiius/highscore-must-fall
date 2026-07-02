// 認証コンテキスト。起動時に /api/me でセッションを確認し、user を配布する。
// dev ログイン / サインアウト後は refresh() で再取得する。

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
  logout: () => Promise<void>
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

  const logout = useCallback(async () => {
    await signOut()
    setUser(null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <AuthContext.Provider value={{ user, loading, refresh, loginDev, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
