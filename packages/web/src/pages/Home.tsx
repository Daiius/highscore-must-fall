// ホーム。ログイン済みなら /runs へ、未ログインならログイン導線（Google + dev バイパス）。

import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { API_BASE_URL } from '../api'
import { useAuth } from '../lib/auth'

export function Home() {
  const { user, loading, loginDev } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && user) void navigate({ to: '/runs' })
  }, [loading, user, navigate])

  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (user) return null

  return (
    <div className="mx-auto max-w-md space-y-6 py-12 text-center">
      <div>
        <h1 className="font-bold text-2xl text-white">Utopia Must Fall 記録・分析</h1>
        <p className="mt-2 text-slate-400 text-sm">
          プレイ結果を記録し、アップグレードの取得傾向やハイスコアの推移を分析します。
        </p>
      </div>
      <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800 p-6">
        <a
          href={`${API_BASE_URL}/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(window.location.origin)}`}
          className="block w-full rounded bg-white px-4 py-2 font-medium text-slate-900 text-sm hover:bg-slate-100"
        >
          Google でログイン
        </a>
        <button
          type="button"
          onClick={() => void loginDev()}
          className="block w-full rounded border border-slate-600 px-4 py-2 text-slate-300 text-sm hover:bg-slate-700"
        >
          開発用ログイン（dev）
        </button>
        <p className="text-slate-500 text-xs">
          Google
          は実クレデンシャル設定時のみ機能します。動作確認は「開発用ログイン」を使ってください。
        </p>
      </div>
    </div>
  )
}
