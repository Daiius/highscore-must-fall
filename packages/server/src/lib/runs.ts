// run 保存サービス（ingestion 下流の「確定保存 API」本体）。
// 検証済みの正規レコード（shared の RunRecord）を run / run_payload / upgrade_entry /
// reward_entry へ 1 トランザクションで書き込み、未知の upgrade/reward 名は unverified で
// カタログに自動登録する（prd/03 §3・§5・prd/04 §3.6）。
//
//   - owner_id はセッション由来（呼び出し側が保証）。子テーブルは run.owner_id と一致させ、
//     (run_id, owner_id) 複合 FK による所有権強制に載せる。
//   - catalog 名寄せは正規形（canonical_key）一致 → alias → 無ければ unverified 自動登録の順。
//     RunRecord の name は shared の catalogName で正規化済みなのでそのまま key に使える。

import { randomUUID } from 'node:crypto'
import {
  catalogAlias,
  db,
  rewardCatalog,
  rewardEntry,
  run,
  runPayload,
  upgradeCatalog,
  upgradeEntry,
} from 'database'
import { and, eq } from 'drizzle-orm'
import type { RunRecord } from 'shared'

/** MVP の投入ルート（file_import / paste のみ。他は Phase2 以降）。 */
export type IngestSource = 'file_import' | 'paste'
export type RunStatus = 'draft' | 'confirmed'

export interface SaveRunInput {
  record: RunRecord
  ownerId: string
  status: RunStatus
  source: IngestSource
  /** 明示上書き（無ければ record.played_at → 投入時刻の順で解決）。 */
  playedAt?: Date
  llmModel?: string
  sourceNote?: string
}

export interface SaveRunResult {
  runId: string
  status: RunStatus
}

/** drizzle トランザクションハンドル（db.transaction のコールバック引数型）。 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * upgrade 名（正規形）を upgrade_catalog の id へ解決する。
 * 既知（canonical_key 一致）→ 別名（catalog_alias）→ 無ければ unverified で自動登録。
 */
async function resolveUpgradeCatalogId(tx: Tx, key: string, runId: string): Promise<string> {
  const existing = await tx
    .select({ id: upgradeCatalog.id })
    .from(upgradeCatalog)
    .where(eq(upgradeCatalog.canonicalKey, key))
    .limit(1)
  if (existing[0]) return existing[0].id

  const alias = await tx
    .select({ id: catalogAlias.upgradeCatalogId })
    .from(catalogAlias)
    .where(and(eq(catalogAlias.catalogKind, 'upgrade'), eq(catalogAlias.aliasKey, key)))
    .limit(1)
  if (alias[0]?.id) return alias[0].id

  const id = randomUUID()
  await tx.insert(upgradeCatalog).values({
    id,
    canonicalKey: key,
    displayName: key, // 正規形を表示にもそのまま使う（別の表示名を持たない）。
    verified: false, // unverified 自動登録。人手 verify/マージで育てる。
    firstSeenRunId: runId,
  })
  return id
}

/** reward 名（正規形）を reward_catalog の id へ解決する（upgrade と同じ順序）。 */
async function resolveRewardCatalogId(tx: Tx, key: string, runId: string): Promise<string> {
  const existing = await tx
    .select({ id: rewardCatalog.id })
    .from(rewardCatalog)
    .where(eq(rewardCatalog.canonicalKey, key))
    .limit(1)
  if (existing[0]) return existing[0].id

  const alias = await tx
    .select({ id: catalogAlias.rewardCatalogId })
    .from(catalogAlias)
    .where(and(eq(catalogAlias.catalogKind, 'reward'), eq(catalogAlias.aliasKey, key)))
    .limit(1)
  if (alias[0]?.id) return alias[0].id

  const id = randomUUID()
  await tx.insert(rewardCatalog).values({
    id,
    canonicalKey: key,
    displayName: key,
    verified: false,
    firstSeenRunId: runId,
  })
  return id
}

/**
 * 検証済み RunRecord を保存する。呼び出し側は事前に shared で検証し、
 * confirmed なら error 無しを保証していること（ここでは DB 書き込みに専念する）。
 */
export async function saveRun(input: SaveRunInput): Promise<SaveRunResult> {
  const { record, ownerId, status, source } = input
  const runId = randomUUID()
  const playedAt = input.playedAt ?? (record.played_at ? new Date(record.played_at) : new Date())
  const rerollCount = record.upgrade_history.filter((e) => e.entry_type === 'reroll').length

  await db.transaction(async (tx) => {
    // run（コア・ホット行）。
    await tx.insert(run).values({
      id: runId,
      ownerId,
      game: record.game,
      playedAt,
      status,
      source,
      schemaVersion: record.schema_version,
      daysSurvived: record.result.days_survived,
      finalScore: record.result.final_score,
      aliensDefeated: record.result.aliens_defeated,
      nukesLaunched: record.result.nukes_launched,
      apocalypseBonus: record.result.apocalypse_bonus,
      rerollCount,
    })

    // run_payload（正規スキーマ全体を丸ごと温存）。
    await tx.insert(runPayload).values({
      runId,
      ownerId,
      rawPayload: record,
      llmModel: input.llmModel,
      sourceNote: input.sourceNote,
    })

    // upgrade_entry（配列順を保ちつつ upgrade 通し番号を採番）。
    let upgradeOrder = 0
    for (const entry of record.upgrade_history) {
      if (entry.entry_type === 'upgrade') {
        upgradeOrder += 1
        const catalogId = await resolveUpgradeCatalogId(tx, entry.name, runId)
        await tx.insert(upgradeEntry).values({
          id: randomUUID(),
          ownerId,
          runId,
          weekIndex: entry.week_index,
          orderInWeek: entry.order_in_week,
          entryType: 'upgrade',
          upgradeCatalogId: catalogId,
          upgradeOrder,
        })
      } else {
        await tx.insert(upgradeEntry).values({
          id: randomUUID(),
          ownerId,
          runId,
          weekIndex: entry.week_index,
          orderInWeek: entry.order_in_week,
          entryType: 'reroll',
          flavorText: entry.flavor_text,
        })
      }
    }

    // reward_entry。
    for (const r of record.reward_ledger) {
      const catalogId = await resolveRewardCatalogId(tx, r.name, runId)
      await tx.insert(rewardEntry).values({
        id: randomUUID(),
        ownerId,
        runId,
        rewardCatalogId: catalogId,
        count: r.count,
        points: r.points,
      })
    }
  })

  return { runId, status }
}
