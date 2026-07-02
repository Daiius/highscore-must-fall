// ルート定義（コードベース）。root レイアウトの下に home/import/runs/detail/analysis を置く。
// 認証ガードは各ページが useAuth で行う（未ログインは Home のログイン導線へ促す）。

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { RootLayout } from './components/RootLayout'
import { Analysis } from './pages/Analysis'
import { Home } from './pages/Home'
import { Import } from './pages/Import'
import { RunDetail } from './pages/RunDetail'
import { Runs } from './pages/Runs'

const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home })

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/import',
  component: Import,
})

const runsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs', component: Runs })

const runDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs/$id',
  component: RunDetail,
})

const analysisRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analysis',
  component: Analysis,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  importRoute,
  runsRoute,
  runDetailRoute,
  analysisRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
