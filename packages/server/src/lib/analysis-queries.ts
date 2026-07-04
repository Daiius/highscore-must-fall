// 分析集計クエリ層（記述分析。prd/06）。confirmed run を SQL で集計し、
// client 側の run 詳細 N+1 取得を排除する。すべて owner_id で分離する。
//
//   - scoreTrend : played_at 昇順の (played_at, final_score)。
//   - stats      : 確定ラン数 / ベスト / 平均。
//   - frequency  : upgrade catalog ごとの取得回数（表示名付き）。
//   - weekByCatalog / orderByCatalog : catalog ごとの週・取得手目(upgrade_order)分布。
//   - timelineRuns / timeline : 直近 TIMELINE_RUN_LIMIT 件の確定 run のメタ（played_at 昇順・
//                  スコア付き。取得ゼロの run も含む）と、upgrade 取得のフラット行
//                  （run×catalog×week。取得タイムライン用）。
// 集計キーは安定した catalog ID。

import { db, run, upgradeCatalog, upgradeEntry } from 'database'
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'

/**
 * 取得タイムラインの対象 run 上限（直近から数える）。
 * 1 run ≈ 20 エントリのため、全期間を返すと最大規模（~1万 run）で応答が数十万行になる。
 * 上限は UI に明示する（暗黙の切り捨てにしない）。
 */
export const TIMELINE_RUN_LIMIT = 200

export async function getAnalysisSummary(ownerId: string) {
  const confirmedRun = and(eq(run.ownerId, ownerId), eq(run.status, 'confirmed'))
  // upgrade_entry 側の共通条件（owner 一致 + 確定 run + upgrade 行）。
  const upgradeCond = and(
    eq(upgradeEntry.ownerId, ownerId),
    eq(run.status, 'confirmed'),
    eq(upgradeEntry.entryType, 'upgrade'),
  )

  const [scoreTrend, statsRows, frequency, weekByCatalog, orderByCatalog] = await Promise.all([
    db
      .select({ playedAt: run.playedAt, finalScore: run.finalScore })
      .from(run)
      .where(confirmedRun)
      .orderBy(asc(run.playedAt), asc(run.id)),
    db
      .select({
        count: count(),
        best: sql<number>`max(${run.finalScore})`,
        avg: sql<number>`round(avg(${run.finalScore}))`,
      })
      .from(run)
      .where(confirmedRun),
    db
      .select({
        catalogId: upgradeEntry.upgradeCatalogId,
        name: upgradeCatalog.displayName,
        count: count(),
      })
      .from(upgradeEntry)
      .innerJoin(run, eq(upgradeEntry.runId, run.id))
      .leftJoin(upgradeCatalog, eq(upgradeEntry.upgradeCatalogId, upgradeCatalog.id))
      .where(upgradeCond)
      .groupBy(upgradeEntry.upgradeCatalogId, upgradeCatalog.displayName),
    db
      .select({
        catalogId: upgradeEntry.upgradeCatalogId,
        week: upgradeEntry.weekIndex,
        count: count(),
      })
      .from(upgradeEntry)
      .innerJoin(run, eq(upgradeEntry.runId, run.id))
      .where(upgradeCond)
      .groupBy(upgradeEntry.upgradeCatalogId, upgradeEntry.weekIndex),
    db
      .select({
        catalogId: upgradeEntry.upgradeCatalogId,
        order: upgradeEntry.upgradeOrder,
        count: count(),
      })
      .from(upgradeEntry)
      .innerJoin(run, eq(upgradeEntry.runId, run.id))
      .where(upgradeCond)
      .groupBy(upgradeEntry.upgradeCatalogId, upgradeEntry.upgradeOrder),
  ])

  // 取得タイムライン: 直近 TIMELINE_RUN_LIMIT 件の確定 run。
  // run メタ（timelineRuns）と取得フラット行（timeline）を分けて返す —
  // エントリ起点だけだと取得ゼロ/リロールのみの run が run 軸・カードから欠落するため。
  const recentRunRows = await db
    .select({ runId: run.id, playedAt: run.playedAt, finalScore: run.finalScore })
    .from(run)
    .where(confirmedRun)
    .orderBy(desc(run.playedAt), desc(run.id))
    .limit(TIMELINE_RUN_LIMIT)
  // 直近 N 件を新しい順で取り、表示用に古い順へ戻す。
  const timelineRuns = [...recentRunRows].reverse()
  const recentRunIds = timelineRuns.map((r) => r.runId)
  const timeline =
    recentRunIds.length === 0
      ? []
      : await db
          .select({
            runId: upgradeEntry.runId,
            catalogId: upgradeEntry.upgradeCatalogId,
            name: upgradeCatalog.displayName,
            week: upgradeEntry.weekIndex,
          })
          .from(upgradeEntry)
          .leftJoin(upgradeCatalog, eq(upgradeEntry.upgradeCatalogId, upgradeCatalog.id))
          .where(
            and(
              eq(upgradeEntry.ownerId, ownerId),
              eq(upgradeEntry.entryType, 'upgrade'),
              inArray(upgradeEntry.runId, recentRunIds),
            ),
          )
          .orderBy(asc(upgradeEntry.weekIndex), asc(upgradeEntry.orderInWeek))

  const stats = statsRows[0]
  return {
    stats: {
      count: stats?.count ?? 0,
      best: Number(stats?.best ?? 0),
      avg: Number(stats?.avg ?? 0),
    },
    scoreTrend,
    frequency: [...frequency].sort((a, b) => b.count - a.count),
    weekByCatalog,
    orderByCatalog,
    timelineRuns,
    timeline,
    timelineRunLimit: TIMELINE_RUN_LIMIT,
  }
}
