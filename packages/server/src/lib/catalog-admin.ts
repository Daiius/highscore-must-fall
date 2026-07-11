// カタログ管理（マージ / 孤児削除）。カタログはグローバルなので **admin 限定**（prd/03 §5・prd/08 §6）。
//
// ここに verify は無い。`verified` の正典は seed であり、昇格は「画像を prd/samples/ にコミットして
// evidence を書く PR」を通す（prd/08 §5）。ボタン一つで立つフラグは根拠が辿れず無価値なため、
// 意図的に API を用意しない。`kind` の変更も同じ理由で作らない（seed が正典）。
//
// 名前の直接編集も作らない。**訂正はマージで表現する** — 旧名を alias に残さないと、
// 同じ誤読を含む過去/未来の投入が名寄せできなくなる（prd/08 §6）。

import { randomUUID } from 'node:crypto'
import {
  catalogAlias,
  db,
  REWARDS,
  rewardCatalog,
  rewardEntry,
  UPGRADES,
  upgradeCatalog,
  upgradeEntry,
} from 'database'
import { and, eq, inArray } from 'drizzle-orm'
import { normalizeName } from 'shared'
import { withDeadlockRetry } from './runs'

export type CatalogKind = 'upgrade' | 'reward'

/**
 * seed（catalog-data.ts）に載っている正規キー。**seed の名前は正典なので消せない**
 * （マージの source にも孤児削除の対象にもしない）。消しても再 seed で復活するため、
 * 「消えたつもりで消えていない」状態を作らないよう API 側で拒否する。
 */
export const SEED_KEYS: Record<CatalogKind, ReadonlySet<string>> = {
  upgrade: new Set(UPGRADES.map((u) => normalizeName(u.name))),
  reward: new Set(REWARDS.map((r) => normalizeName(r.name))),
}

/** 孤児判定の材料（prd/08 §7 の4条件）。 */
export interface OrphanCandidate {
  canonicalKey: string
  verified: boolean
  /** *_entry からの参照数。 */
  refCount: number
  /** この行を統合先とする catalog_alias の数。 */
  aliasCount: number
}

/**
 * 孤児 = 誤読の残骸。run 編集での名前訂正・run 削除で必ず溜まる（prd/08 §7）。
 * 4条件をすべて満たす行のみ削除してよい。**自動削除はしない**（明示実行）。
 */
export function isOrphan(row: OrphanCandidate, kind: CatalogKind): boolean {
  return (
    !row.verified &&
    !SEED_KEYS[kind].has(row.canonicalKey) &&
    row.refCount === 0 &&
    row.aliasCount === 0
  )
}

/**
 * 初出 run へ辿れるか。**カタログはグローバルなので、初出が他ユーザーの run であることは普通に起こる**
 * （未知名は誰の投入でも自動登録される。prd/03 §5）。一方 run は owner スコープで、admin でも他人の
 * run 詳細は見られない（prd/05 §2。画像もそこにぶら下がる）。
 *
 * そこで **id を出すのは自分の run のときだけ**にし、他人の run は「ある」ことだけを伝える。
 * 到達できないリンクを出さない（押せば必ず 404 になる導線を置かない）ためであり、admin に他人の run を
 * 覗かせるための抜け道も作らない。他プレイヤーの画像を根拠に使う道は、オプトインで恒久原典
 * （`prd/samples/`）へ写し取る形でのみ開く（prd/08 §9.3・未実装）。
 */
export function firstSeenLink(
  firstSeenRunId: string | null,
  firstSeenOwnerId: string | null,
  viewerId: string,
): { firstSeenRunId: string | null; firstSeenRunExists: boolean } {
  return {
    firstSeenRunId: firstSeenOwnerId === viewerId ? firstSeenRunId : null,
    firstSeenRunExists: firstSeenRunId !== null,
  }
}

export type CatalogMutationError =
  | 'not_found'
  | 'same_entry'
  | 'seed_protected'
  | 'not_orphan'
  | 'verified_source'

export type CatalogMutationResult =
  | { ok: true; mergedEntries: number }
  | { ok: false; code: CatalogMutationError }

/**
 * source を target に統合する（B を A に寄せる）。
 *   1. 配下の *_entry を target へ付け替える
 *   2. source を指していた alias を target へ張り替える
 *   3. source の正規キーを target の alias として登録する（過去/未来の同じ誤読を名寄せするため）
 *   4. source を削除する
 *
 * source が seed / verified の名前なら拒否する。seed の行は再 seed で復活するし、
 * verified は「実在する」と裏取り済みの名前なので、そもそも誤読ではない。
 */
export async function mergeCatalogEntry(
  kind: CatalogKind,
  sourceId: string,
  targetId: string,
): Promise<CatalogMutationResult> {
  if (sourceId === targetId) return { ok: false, code: 'same_entry' }
  // 並行する run 投入とはロック順が交差しうる（投入は alias 行 → 統合先カタログ行、マージは
  // カタログ行 → alias 行）。投入側と同じく限定的に再試行し、admin 操作が一過性の
  // デッドロック/ロック待ちで 500 にならないようにする（HSF-17D3E52C）。
  return withDeadlockRetry(() =>
    kind === 'upgrade' ? mergeUpgrade(sourceId, targetId) : mergeReward(sourceId, targetId),
  )
}

/** 同時マージのデッドロックを避けるため、行ロックは id 昇順で取る（決定順）。 */
function lockOrder(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

async function mergeUpgrade(sourceId: string, targetId: string): Promise<CatalogMutationResult> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({
        id: upgradeCatalog.id,
        canonicalKey: upgradeCatalog.canonicalKey,
        verified: upgradeCatalog.verified,
      })
      .from(upgradeCatalog)
      .where(inArray(upgradeCatalog.id, lockOrder(sourceId, targetId)))
      .for('update')
    const source = locked.find((r) => r.id === sourceId)
    const target = locked.find((r) => r.id === targetId)
    if (!source || !target) return { ok: false, code: 'not_found' } as const
    if (source.verified) return { ok: false, code: 'verified_source' } as const
    if (SEED_KEYS.upgrade.has(source.canonicalKey)) {
      return { ok: false, code: 'seed_protected' } as const
    }

    const moved = await tx
      .update(upgradeEntry)
      .set({ upgradeCatalogId: targetId })
      .where(eq(upgradeEntry.upgradeCatalogId, sourceId))

    await tx
      .update(catalogAlias)
      .set({ upgradeCatalogId: targetId })
      .where(
        and(eq(catalogAlias.catalogKind, 'upgrade'), eq(catalogAlias.upgradeCatalogId, sourceId)),
      )
    // 旧名（source の正規キー）→ target。同じ誤読が再投入されても target に名寄せされる。
    await tx
      .insert(catalogAlias)
      .values({
        id: randomUUID(),
        catalogKind: 'upgrade',
        upgradeCatalogId: targetId,
        aliasKey: source.canonicalKey,
      })
      .onDuplicateKeyUpdate({ set: { upgradeCatalogId: targetId } })

    await tx.delete(upgradeCatalog).where(eq(upgradeCatalog.id, sourceId))
    return { ok: true, mergedEntries: affectedRows(moved) } as const
  })
}

async function mergeReward(sourceId: string, targetId: string): Promise<CatalogMutationResult> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({
        id: rewardCatalog.id,
        canonicalKey: rewardCatalog.canonicalKey,
        verified: rewardCatalog.verified,
      })
      .from(rewardCatalog)
      .where(inArray(rewardCatalog.id, lockOrder(sourceId, targetId)))
      .for('update')
    const source = locked.find((r) => r.id === sourceId)
    const target = locked.find((r) => r.id === targetId)
    if (!source || !target) return { ok: false, code: 'not_found' } as const
    if (source.verified) return { ok: false, code: 'verified_source' } as const
    if (SEED_KEYS.reward.has(source.canonicalKey)) {
      return { ok: false, code: 'seed_protected' } as const
    }

    const sourceRows = await tx
      .select({
        id: rewardEntry.id,
        runId: rewardEntry.runId,
        count: rewardEntry.count,
        points: rewardEntry.points,
      })
      .from(rewardEntry)
      .where(eq(rewardEntry.rewardCatalogId, sourceId))
      .for('update')
    const targetRows = await tx
      .select({
        id: rewardEntry.id,
        runId: rewardEntry.runId,
        count: rewardEntry.count,
        points: rewardEntry.points,
      })
      .from(rewardEntry)
      .where(eq(rewardEntry.rewardCatalogId, targetId))
      .for('update')

    const plan = planRewardMerge(sourceRows, targetRows)
    for (const u of plan.updates) {
      await tx
        .update(rewardEntry)
        .set({ rewardCatalogId: targetId, count: u.count, points: u.points })
        .where(eq(rewardEntry.id, u.id))
    }
    if (plan.deletes.length > 0) {
      await tx.delete(rewardEntry).where(inArray(rewardEntry.id, plan.deletes))
    }

    await tx
      .update(catalogAlias)
      .set({ rewardCatalogId: targetId })
      .where(
        and(eq(catalogAlias.catalogKind, 'reward'), eq(catalogAlias.rewardCatalogId, sourceId)),
      )
    await tx
      .insert(catalogAlias)
      .values({
        id: randomUUID(),
        catalogKind: 'reward',
        rewardCatalogId: targetId,
        aliasKey: source.canonicalKey,
      })
      .onDuplicateKeyUpdate({ set: { rewardCatalogId: targetId } })

    await tx.delete(rewardCatalog).where(eq(rewardCatalog.id, sourceId))
    return { ok: true, mergedEntries: sourceRows.length } as const
  })
}

/** reward マージで書き換える行（`rewardCatalogId` は常に統合先に付け替える）。 */
export interface RewardMergeUpdate {
  id: string
  count: number
  points: number
}

export interface RewardMergePlan {
  updates: RewardMergeUpdate[]
  deletes: string[]
}

/**
 * reward_entry は「run 内の1名前 = 1行」（リワード台帳の集計行）。統合すると同じ run に同名2行が
 * できうるので、**run ごとに1行へ畳む**（回数・点は合算）。誤読で1つの台帳行が2つに割れていた、が実態。
 *
 * 同じ run に統合元の行が**複数**あることもある（`reward_ledger` の名前重複を schema も DB も禁じて
 * いない＝LLM の誤読で起こりうる）。したがって「1行ずつ統合先に足す」実装では、2行目以降の更新が
 * 直前の合算結果を上書きして回数・点を失う。**先に run 単位で合算してから1回だけ書く**。
 *
 * 残す行は id 昇順で先頭（決定的に選ぶ）。純関数にしてあるのはここをテストで固定するため。
 */
export function planRewardMerge(
  sourceRows: readonly RewardEntryRow[],
  targetRows: readonly RewardEntryRow[],
): RewardMergePlan {
  const byRun = new Map<string, { ids: string[]; count: number; points: number }>()
  const fold = (rows: readonly RewardEntryRow[]) => {
    for (const row of rows) {
      const agg = byRun.get(row.runId) ?? { ids: [], count: 0, points: 0 }
      agg.ids.push(row.id)
      agg.count += row.count
      agg.points += row.points
      byRun.set(row.runId, agg)
    }
  }
  // 統合先の行を先に畳む（run 内に統合先が既にあれば、その行を残す）。
  fold(targetRows)
  fold(sourceRows)

  const sourceRunIds = new Set(sourceRows.map((r) => r.runId))
  const updates: RewardMergeUpdate[] = []
  const deletes: string[] = []
  for (const [runId, agg] of byRun) {
    // 統合元が1行も無い run は触らない（統合先だけの run は現状のまま）。
    if (!sourceRunIds.has(runId)) continue
    const ids = [...agg.ids].sort()
    const keep = ids[0]
    if (keep === undefined) continue
    updates.push({ id: keep, count: agg.count, points: agg.points })
    deletes.push(...ids.slice(1))
  }
  return { updates, deletes }
}

export interface RewardEntryRow {
  id: string
  runId: string
  count: number
  points: number
}

/**
 * 孤児を削除する。**トランザクション内で4条件を取り直して再判定する**
 * （一覧を見てから押すまでの間に run が投入されて参照が付く可能性があるため）。
 */
export async function deleteOrphanCatalogEntry(
  kind: CatalogKind,
  id: string,
): Promise<CatalogMutationResult> {
  // マージと同じ理由で再試行する（並行投入とロック順が交差しうる）。
  return withDeadlockRetry(() =>
    kind === 'upgrade' ? deleteOrphanUpgrade(id) : deleteOrphanReward(id),
  )
}

async function deleteOrphanUpgrade(id: string): Promise<CatalogMutationResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: upgradeCatalog.id,
        canonicalKey: upgradeCatalog.canonicalKey,
        verified: upgradeCatalog.verified,
      })
      .from(upgradeCatalog)
      .where(eq(upgradeCatalog.id, id))
      .for('update')
    const row = rows[0]
    if (!row) return { ok: false, code: 'not_found' } as const

    const refs = await tx
      .select({ id: upgradeEntry.id })
      .from(upgradeEntry)
      .where(eq(upgradeEntry.upgradeCatalogId, id))
      .limit(1)
      .for('update')
    const aliases = await tx
      .select({ id: catalogAlias.id })
      .from(catalogAlias)
      .where(and(eq(catalogAlias.catalogKind, 'upgrade'), eq(catalogAlias.upgradeCatalogId, id)))
      .limit(1)
      .for('update')
    if (
      !isOrphan(
        {
          canonicalKey: row.canonicalKey,
          verified: row.verified,
          refCount: refs.length,
          aliasCount: aliases.length,
        },
        'upgrade',
      )
    ) {
      return { ok: false, code: 'not_orphan' } as const
    }

    await tx.delete(upgradeCatalog).where(eq(upgradeCatalog.id, id))
    return { ok: true, mergedEntries: 0 } as const
  })
}

async function deleteOrphanReward(id: string): Promise<CatalogMutationResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: rewardCatalog.id,
        canonicalKey: rewardCatalog.canonicalKey,
        verified: rewardCatalog.verified,
      })
      .from(rewardCatalog)
      .where(eq(rewardCatalog.id, id))
      .for('update')
    const row = rows[0]
    if (!row) return { ok: false, code: 'not_found' } as const

    const refs = await tx
      .select({ id: rewardEntry.id })
      .from(rewardEntry)
      .where(eq(rewardEntry.rewardCatalogId, id))
      .limit(1)
      .for('update')
    const aliases = await tx
      .select({ id: catalogAlias.id })
      .from(catalogAlias)
      .where(and(eq(catalogAlias.catalogKind, 'reward'), eq(catalogAlias.rewardCatalogId, id)))
      .limit(1)
      .for('update')
    if (
      !isOrphan(
        {
          canonicalKey: row.canonicalKey,
          verified: row.verified,
          refCount: refs.length,
          aliasCount: aliases.length,
        },
        'reward',
      )
    ) {
      return { ok: false, code: 'not_orphan' } as const
    }

    await tx.delete(rewardCatalog).where(eq(rewardCatalog.id, id))
    return { ok: true, mergedEntries: 0 } as const
  })
}

/** drizzle/mysql2 の update 結果から affectedRows を取り出す（型は driver 依存）。 */
function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result
  const n = (header as { affectedRows?: number } | undefined)?.affectedRows
  return typeof n === 'number' ? n : 0
}
