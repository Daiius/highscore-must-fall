// 全ページ共通レイアウト。ヘッダ（ナビ + 認証状態）と Outlet。
// 未ログインは Home のログイン導線へ促す（各ページ側でもガードする）。
//
// ナビ/ログアウトは「アイコン + ラベル」で、狭い画面ではラベルだけを畳んでアイコンのみにする。
// ラベルを畳む境界が lg なのは、日本語ラベルを全部並べると 640px/768px では収まらず
// 折り返してしまうため（モバイルで1文字ずつ縦積みになっていた元の不具合）。
// ラベルは CSS で消える＝アクセシビリティツリーからも消えるので、aria-label を常に持たせる。

import { Link, Outlet } from '@tanstack/react-router'
import { useAuth } from '../lib/auth'
import {
  ArrowRightStartOnRectangleIcon,
  ArrowUpTrayIcon,
  BookOpenIcon,
  ChartBarIcon,
  ListBulletIcon,
} from './Icons'

const navLinkClass =
  'flex items-center gap-1.5 rounded p-2 font-medium text-slate-300 text-sm transition-colors hover:bg-slate-700 hover:text-white lg:px-3 lg:py-1.5 [&.active]:bg-indigo-600 [&.active]:text-white'
const navIconClass = 'size-5 shrink-0'
const navLabelClass = 'hidden lg:inline'

export function RootLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-slate-700 border-b bg-slate-800/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 sm:gap-4">
          <Link
            to="/"
            className="min-w-0 truncate font-bold text-base text-white tracking-tight sm:text-lg"
          >
            Highscore Must Fall
          </Link>
          {user && (
            <nav className="ml-auto flex items-center gap-1">
              <Link to="/runs" className={navLinkClass} aria-label="ラン一覧" title="ラン一覧">
                <ListBulletIcon className={navIconClass} />
                <span className={navLabelClass}>ラン一覧</span>
              </Link>
              <Link
                to="/import"
                className={navLinkClass}
                aria-label="インポート"
                title="インポート"
              >
                <ArrowUpTrayIcon className={navIconClass} />
                <span className={navLabelClass}>インポート</span>
              </Link>
              <Link to="/analysis" className={navLinkClass} aria-label="分析" title="分析">
                <ChartBarIcon className={navIconClass} />
                <span className={navLabelClass}>分析</span>
              </Link>
              {/* カタログはグローバル。マージ・孤児削除は全 owner に効くので admin だけに出す。 */}
              {user.role === 'admin' && (
                <Link to="/catalog" className={navLinkClass} aria-label="カタログ" title="カタログ">
                  <BookOpenIcon className={navIconClass} />
                  <span className={navLabelClass}>カタログ</span>
                </Link>
              )}
            </nav>
          )}
          <div className={user ? 'flex items-center gap-2' : 'ml-auto flex items-center'}>
            {user ? (
              <>
                <span className="hidden max-w-40 truncate text-slate-400 text-sm sm:inline">
                  {user.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void logout().then((ok) => {
                      if (!ok) alert('ログアウトに失敗しました。時間をおいて再試行してください。')
                    })
                  }}
                  aria-label="ログアウト"
                  title="ログアウト"
                  className="flex items-center gap-1.5 rounded border border-slate-600 p-2 text-slate-300 text-sm hover:bg-slate-700 lg:px-3 lg:py-1.5"
                >
                  <ArrowRightStartOnRectangleIcon className={navIconClass} />
                  <span className={navLabelClass}>ログアウト</span>
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
