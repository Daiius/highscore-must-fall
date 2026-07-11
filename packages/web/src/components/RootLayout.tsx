// 全ページ共通レイアウト。ヘッダ（ナビ + 認証状態）と Outlet。
// 未ログインは Home のログイン導線へ促す（各ページ側でもガードする）。

import { Link, Outlet } from '@tanstack/react-router'
import { useAuth } from '../lib/auth'

const navLinkClass =
  'rounded px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white [&.active]:bg-indigo-600 [&.active]:text-white'

export function RootLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-slate-700 border-b bg-slate-800/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="font-bold text-lg text-white tracking-tight">
            Highscore Must Fall
          </Link>
          {user && (
            <nav className="flex items-center gap-1">
              <Link to="/runs" className={navLinkClass}>
                ラン一覧
              </Link>
              <Link to="/import" className={navLinkClass}>
                インポート
              </Link>
              <Link to="/analysis" className={navLinkClass}>
                分析
              </Link>
              {/* カタログはグローバル。マージ・孤児削除は全 owner に効くので admin だけに出す。 */}
              {user.role === 'admin' && (
                <Link to="/catalog" className={navLinkClass}>
                  カタログ
                </Link>
              )}
            </nav>
          )}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-slate-400 text-sm">{user.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    void logout().then((ok) => {
                      if (!ok) alert('ログアウトに失敗しました。時間をおいて再試行してください。')
                    })
                  }}
                  className="rounded border border-slate-600 px-3 py-1.5 text-slate-300 text-sm hover:bg-slate-700"
                >
                  ログアウト
                </button>
              </>
            ) : (
              <span className="text-slate-500 text-sm">未ログイン</span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
