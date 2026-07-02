// analysis ルート（記述分析の集計。prd/06）。owner の confirmed run を server 側で集計して返す
// （client 側の run 詳細 N+1 取得を排除）。

import { Hono } from 'hono'
import { getAnalysisSummary } from '../lib/analysis-queries'
import { type AppEnv, requireUser } from '../lib/context'

export const analysisRoute = new Hono<AppEnv>().get('/summary', requireUser, async (c) => {
  const owner = c.get('user')
  if (!owner) return c.json({ error: 'authentication required' }, 401)
  return c.json(await getAnalysisSummary(owner.id))
})
