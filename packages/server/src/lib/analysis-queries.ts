// 分析集計クエリ層（記述分析。prd/06）。confirmed run を SQL で集計し、
// client 側の run 詳細 N+1 取得を排除する。すべて owner_id で分離する。
//
//   - scoreTrend : played_at 昇順の (played_at, final_score)。
//   - stats      : 確定ラン数 / ベスト / 平均。
//   - frequency  : upgrade catalog ごとの取得回数（表示名・verified 付き。タイムラインの行順と、
//                  「未検証を N 件含む」注記に使用）。
//   - timelineRuns / timeline : 直近 TIMELINE_RUN_LIMIT 件の確定 run のメタ（played_at 昇順・
//                  スコア付き。取得ゼロの run も含む）と、upgrade 取得のフラット行
//                  （run×catalog×week。取得タイムライン用）。
// 集計キーは安定した catalog ID。

import { db, run, upgradeCatalog, upgradeEntry } from 'database'
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  type AnalysisEntry,
  type AnalysisRunInput,
  buildTrendAnalysis,
  type TrendAnalysis,
} from 'shared'

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

  const [scoreTrend, statsRows, frequency] = await Promise.all([
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
        // verified は表示専用（集計は絞らない）。UI の「未検証を N 件含む」注記に使う。prd/06 §1.1。
        verified: upgradeCatalog.verified,
        count: count(),
      })
      .from(upgradeEntry)
      .innerJoin(run, eq(upgradeEntry.runId, run.id))
      .leftJoin(upgradeCatalog, eq(upgradeEntry.upgradeCatalogId, upgradeCatalog.id))
      .where(upgradeCond)
      .groupBy(upgradeEntry.upgradeCatalogId, upgradeCatalog.displayName, upgradeCatalog.verified),
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
    timelineRuns,
    timeline,
    timelineRunLimit: TIMELINE_RUN_LIMIT,
  }
}

/**
 * 傾向分析（prd/06 §2）の対象 run 上限（直近から数える）。
 * 記述分析のタイムライン（TIMELINE_RUN_LIMIT）と同じ考え方で、上限は UI に明示する。
 * 散布図は 1 系統あたり run 数ぶんの点になるため、送信量と可読性の両方で上限が要る。
 */
export const TREND_RUN_LIMIT = 200

/**
 * 傾向分析の集計。SQL で行を取り、系統への畳み込みと仮取得日の算出は shared の純粋関数に任せる
 * （系統マッピングが TS 側にあり SQL だけでは完結しないため。prd/06 §2）。
 *
 * **事前集計テーブルは作らない**（prd/06 §4）。毎回組み立てるので、カタログの訂正や
 * 系統分類の追加は次の描画から反映される（prd/06 §4.1 の「訂正が凍結されない」要件）。
 */
export async function getTrendAnalysis(
  ownerId: string,
): Promise<TrendAnalysis & { runLimit: number }> {
  const recentRuns = await db
    .select({
      runId: run.id,
      finalScore: run.finalScore,
      daysSurvived: run.daysSurvived,
      nukesLaunched: run.nukesLaunched,
    })
    .from(run)
    .where(and(eq(run.ownerId, ownerId), eq(run.status, 'confirmed')))
    .orderBy(desc(run.playedAt), desc(run.id))
    .limit(TREND_RUN_LIMIT)

  const runIds = recentRuns.map((r) => r.runId)
  const rows =
    runIds.length === 0
      ? []
      : await db
          .select({
            runId: upgradeEntry.runId,
            weekIndex: upgradeEntry.weekIndex,
            orderInWeek: upgradeEntry.orderInWeek,
            entryType: upgradeEntry.entryType,
            name: upgradeCatalog.displayName,
            kind: upgradeCatalog.kind,
          })
          .from(upgradeEntry)
          .leftJoin(upgradeCatalog, eq(upgradeEntry.upgradeCatalogId, upgradeCatalog.id))
          .where(and(eq(upgradeEntry.ownerId, ownerId), inArray(upgradeEntry.runId, runIds)))
          .orderBy(asc(upgradeEntry.weekIndex), asc(upgradeEntry.orderInWeek))

  const entriesByRun = new Map<string, AnalysisEntry[]>()
  for (const row of rows) {
    const entry: AnalysisEntry = {
      weekIndex: row.weekIndex,
      orderInWeek: row.orderInWeek,
      entryType: row.entryType,
      name: row.name ?? null,
      kind: row.kind ?? null,
    }
    const list = entriesByRun.get(row.runId)
    if (list) list.push(entry)
    else entriesByRun.set(row.runId, [entry])
  }

  // draft を許すため DB 上は nullable だが、confirmed では埋まっている（prd/03 §4）。
  const inputs: AnalysisRunInput[] = recentRuns.map((r) => ({
    runId: r.runId,
    finalScore: r.finalScore ?? 0,
    daysSurvived: r.daysSurvived ?? 0,
    nukesLaunched: r.nukesLaunched ?? 0,
    entries: entriesByRun.get(r.runId) ?? [],
  }))

  return { ...buildTrendAnalysis(inputs), runLimit: TREND_RUN_LIMIT }
}
