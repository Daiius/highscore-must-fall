// catalog ルート（グローバル・prd/03 §5）。名寄せ表示・分析・カタログ管理（Task 8）が参照する。
// 読み取りは認証済みユーザーに開放（カタログは客観的事実で owner を持たないが、
// アプリの内部 API なので投入・閲覧と同じ認証境界に揃える）。verify/マージの書き込みは Task 8。

import { Hono } from 'hono'
import { listRewardCatalog, listUpgradeCatalog } from '../lib/catalog-queries'
import { type AppEnv, requireUser } from '../lib/context'

export const catalogRoute = new Hono<AppEnv>().get('/', requireUser, async (c) => {
  const [upgrades, rewards] = await Promise.all([listUpgradeCatalog(), listRewardCatalog()])
  return c.json({ upgrades, rewards })
})
