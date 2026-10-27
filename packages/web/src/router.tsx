// ルート定義（コードベース）。root レイアウトの下に home/import/runs/detail/analysis を置く。
// 認証ガードは各ページが useAuth で行う（未ログインは Home のログイン導線へ促す）。

import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { RootLayout } from './components/RootLayout'
import { RequireAuth } from './lib/auth'
import { Home } from './pages/Home'

// 入口の Home 以外はルート単位で分割し、開いたときに読む（分析画面の recharts などを初回の
// 読み込みから外す）。チャンクが増えても、配信先は deploy-static が 2 世代分に保つ（prd/02 §9.2）。
const Import = lazyRouteComponent(() => import('./pages/Import'), 'Import')
const Runs = lazyRouteComponent(() => import('./pages/Runs'), 'Runs')
const RunDetail = lazyRouteComponent(() => import('./pages/RunDetail'), 'RunDetail')
const Analysis = lazyRouteComponent(() => import('./pages/Analysis'), 'Analysis')
const Catalog = lazyRouteComponent(() => import('./pages/Catalog'), 'Catalog')

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
