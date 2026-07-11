// ルート定義（コードベース）。root レイアウトの下に home/import/runs/detail/analysis を置く。
// 認証ガードは各ページが useAuth で行う（未ログインは Home のログイン導線へ促す）。

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { RootLayout } from './components/RootLayout'
import { RequireAuth } from './lib/auth'
import { Analysis } from './pages/Analysis'
import { Catalog } from './pages/Catalog'
import { Home } from './pages/Home'
import { Import } from './pages/Import'
import { RunDetail } from './pages/RunDetail'
import { Runs } from './pages/Runs'

/** 認証必須ページを RequireAuth で包む。 */
const guarded = (node: ReactNode) => () => <RequireAuth>{node}</RequireAuth>

const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home })

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/import',
  component: guarded(<Import />),
})

const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs',
  component: guarded(<Runs />),
})

const runDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs/$id',
  component: guarded(<RunDetail />),
})

const analysisRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analysis',
  component: guarded(<Analysis />),
})

// カタログ管理は admin 限定（server 側も requireAdmin。ページ内でも role を見て弾く）。
const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  component: guarded(<Catalog />),
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  importRoute,
  runsRoute,
  runDetailRoute,
  analysisRoute,
  catalogRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
