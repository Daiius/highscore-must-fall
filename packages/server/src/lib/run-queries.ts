// run 読み取りクエリ層（一覧 / 詳細 / 削除）。すべて owner_id を条件に含める（他ユーザーのデータに触れない）。
// 一覧はホット行のみ（raw_payload を読まない）。詳細は子テーブル＋カタログ表示名＋payload まで含める。
// 方針: .claude/rules/database.md（owner 分離・raw_payload 分離）/ prd/03 §3・§6。

import {
  db,
  rewardCatalog,
  rewardEntry,
  run,
  runImage,
  runPayload,
  upgradeCatalog,
  upgradeEntry,
} from 'database'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import type { RunRecord } from 'shared'
import type { RunStatus } from './runs'

/** 一覧の 1 行（集計・ソート用のコア指標のみ。raw_payload は含めない）。 */
const runListColumns = {
  id: run.id,
  playedAt: run.playedAt,
  status: run.status,
  source: run.source,
  game: run.game,
  finalScore: run.finalScore,
  daysSurvived: run.daysSurvived,
  aliensDefeated: run.aliensDefeated,
  nukesLaunched: run.nukesLaunched,
  apocalypseBonus: run.apocalypseBonus,
  rerollCount: run.rerollCount,
  createdAt: run.createdAt,
}

export interface ListRunsParams {
  limit: number
  offset: number
  status?: RunStatus
}

export interface ListRunsResult {
  runs: Awaited<ReturnType<typeof selectRunList>>
  total: number
}

function selectRunList(ownerId: string, params: ListRunsParams) {
  const where = params.status
    ? and(eq(run.ownerId, ownerId), eq(run.status, params.status))
    : eq(run.ownerId, ownerId)
  return (
    db
      .select(runListColumns)
      .from(run)
      .where(where)
      // id を最終 tie-breaker に（played_at/created_at が同値でもページ間で順序を確定させ、
      // offset ページングでの重複/欠落を防ぐ）。
      .orderBy(desc(run.playedAt), desc(run.createdAt), desc(run.id))
      .limit(params.limit)
      .offset(params.offset)
  )
}

/** owner の run を新しい順に一覧（総件数付き）。 */
export async function listRuns(ownerId: string, params: ListRunsParams): Promise<ListRunsResult> {
  const where = params.status
    ? and(eq(run.ownerId, ownerId), eq(run.status, params.status))
    : eq(run.ownerId, ownerId)
  const [runs, totalRows] = await Promise.all([
    selectRunList(ownerId, params),
    db.select({ value: count() }).from(run).where(where),
  ])
  return { runs, total: totalRows[0]?.value ?? 0 }
}

/** owner の run 1 件の詳細（コア + 子エントリ + カタログ表示名 + payload + 画像）。無ければ null。 */
export async function getRunDetail(ownerId: string, id: string) {
  const runRows = await db
    .select(runListColumns)
    .from(run)
    .where(and(eq(run.id, id), eq(run.ownerId, ownerId)))
    .limit(1)
  const core = runRows[0]
  if (!core) return null

  const [upgrades, rewards, payloadRows, images] = await Promise.all([
    // upgrade/reroll エントリ（週・週内順で整列。upgrade は catalog 表示名を join）。
    db
      .select({
        id: upgradeEntry.id,
        weekIndex: upgradeEntry.weekIndex,
        orderInWeek: upgradeEntry.orderInWeek,
        entryType: upgradeEntry.entryType,
        upgradeOrder: upgradeEntry.upgradeOrder,
        flavorText: upgradeEntry.flavorText,
        catalogId: upgradeCatalog.id,
        name: upgradeCatalog.displayName,
        kind: upgradeCatalog.kind,
        verified: upgradeCatalog.verified,
      })
      .from(upgradeEntry)
      .leftJoin(upgradeCatalog, eq(upgradeEntry.upgradeCatalogId, upgradeCatalog.id))
      .where(and(eq(upgradeEntry.runId, id), eq(upgradeEntry.ownerId, ownerId)))
      .orderBy(asc(upgradeEntry.weekIndex), asc(upgradeEntry.orderInWeek)),
    // reward エントリ（catalog 表示名を join）。
    db
      .select({
        id: rewardEntry.id,
        name: rewardCatalog.displayName,
        catalogId: rewardCatalog.id,
        verified: rewardCatalog.verified,
        count: rewardEntry.count,
        points: rewardEntry.points,
      })
      .from(rewardEntry)
      .innerJoin(rewardCatalog, eq(rewardEntry.rewardCatalogId, rewardCatalog.id))
      .where(and(eq(rewardEntry.runId, id), eq(rewardEntry.ownerId, ownerId)))
      .orderBy(desc(rewardEntry.points)),
    // payload（監査/全項目表示用。詳細でのみ読む）。
    db
      .select({
        rawPayload: runPayload.rawPayload,
        llmModel: runPayload.llmModel,
        sourceNote: runPayload.sourceNote,
      })
      .from(runPayload)
      .where(and(eq(runPayload.runId, id), eq(runPayload.ownerId, ownerId)))
      .limit(1),
    // 画像メタ（実体配信は別エンドポイント。3b で追加）。
    db
      .select({
        id: runImage.id,
        section: runImage.section,
        contentType: runImage.contentType,
        byteSize: runImage.byteSize,
        width: runImage.width,
        height: runImage.height,
      })
      .from(runImage)
      .where(and(eq(runImage.runId, id), eq(runImage.ownerId, ownerId))),
  ])

  const payload = payloadRows[0]
  return {
    ...core,
    upgradeEntries: upgrades,
    rewardEntries: rewards,
    images,
    rawPayload: (payload?.rawPayload ?? null) as RunRecord | null,
    llmModel: payload?.llmModel ?? null,
    sourceNote: payload?.sourceNote ?? null,
  }
}

/** owner の run を削除する（子テーブル・画像メタは複合 FK cascade）。削除できたら true。 */
export async function deleteRun(ownerId: string, id: string): Promise<boolean> {
  // drizzle(mysql2) の delete は [ResultSetHeader, FieldPacket[]] を返す。
  const [header] = await db.delete(run).where(and(eq(run.id, id), eq(run.ownerId, ownerId)))
  return header.affectedRows > 0
}
