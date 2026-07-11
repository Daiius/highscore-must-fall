// カタログ読み取りクエリ層。カタログはグローバル（owner を持たない）。prd/03 §5。
// 一覧は表示名昇順。名寄せサジェスト（web）と、カタログ管理 UI（prd/08 §6）が参照する。

import {
  catalogAlias,
  db,
  rewardCatalog,
  rewardEntry,
  run,
  upgradeCatalog,
  upgradeEntry,
} from 'database'
import { asc, count, eq, isNotNull } from 'drizzle-orm'
import { type CatalogKind, firstSeenLink, isOrphan, SEED_KEYS } from './catalog-admin'

/** upgrade_catalog 一覧（正規キー・表示名・kind・verified）。 */
export async function listUpgradeCatalog() {
  return db
    .select({
      id: upgradeCatalog.id,
      canonicalKey: upgradeCatalog.canonicalKey,
      displayName: upgradeCatalog.displayName,
      kind: upgradeCatalog.kind,
      verified: upgradeCatalog.verified,
    })
    .from(upgradeCatalog)
    .orderBy(asc(upgradeCatalog.displayName))
}

/** reward_catalog 一覧。 */
export async function listRewardCatalog() {
  return db
    .select({
      id: rewardCatalog.id,
      canonicalKey: rewardCatalog.canonicalKey,
      displayName: rewardCatalog.displayName,
      verified: rewardCatalog.verified,
    })
    .from(rewardCatalog)
    .orderBy(asc(rewardCatalog.displayName))
}

/** カタログ管理 UI の1行（prd/08 §6）。 */
export interface ManagedCatalogRow {
  id: string
  canonicalKey: string
  displayName: string
  /** upgrade のみ。reward は null。 */
  kind: 'contract' | 'opportunity_upgrade' | null
  verified: boolean
  /**
   * 初出 run。**閲覧者自身の run のときだけ id が入る**（他 owner の run へは辿れない。prd/05 §2）。
   * カタログはグローバルなので、初出が他ユーザーの run であることは普通に起こる。
   */
  firstSeenRunId: string | null
  /** 初出 run が存在するか（閲覧できなくても「ある」ことは分かる。run 削除で false）。 */
  firstSeenRunExists: boolean
  /** *_entry からの参照数（全 owner 横断。カタログはグローバルなため）。 */
  refCount: number
  /** この行を統合先とする別名（過去にマージした旧名）。 */
  aliases: string[]
  /** seed（catalog-data.ts）に載っている名前か。true なら削除・マージの source にできない。 */
  inSeed: boolean
  /** 孤児（prd/08 §7 の4条件）。削除できるのはこれだけ。 */
  orphan: boolean
}

/**
 * カタログ管理 UI 用の一覧。参照数・別名・孤児判定を添える。
 *
 * カタログは数百行なので、集計はグループ化した結果を JS で突き合わせる（1行ずつ引かない）。
 * 参照数は **全 owner 横断**である — カタログがグローバルで、マージ・削除の影響も全 owner に
 * 及ぶ以上、「これは誰かが使っているか」は owner を跨いで数えないと判定にならない
 * （admin 限定ルート。prd/03 §5）。
 */
export async function listCatalogForManagement(viewerId: string): Promise<{
  upgrades: ManagedCatalogRow[]
  rewards: ManagedCatalogRow[]
}> {
  const [upgradeRows, rewardRows, upgradeRefs, rewardRefs, aliases] = await Promise.all([
    db
      .select({
        id: upgradeCatalog.id,
        canonicalKey: upgradeCatalog.canonicalKey,
        displayName: upgradeCatalog.displayName,
        kind: upgradeCatalog.kind,
        verified: upgradeCatalog.verified,
        firstSeenRunId: upgradeCatalog.firstSeenRunId,
        firstSeenOwnerId: run.ownerId,
      })
      .from(upgradeCatalog)
      .leftJoin(run, eq(upgradeCatalog.firstSeenRunId, run.id))
      .orderBy(asc(upgradeCatalog.displayName)),
    db
      .select({
        id: rewardCatalog.id,
        canonicalKey: rewardCatalog.canonicalKey,
        displayName: rewardCatalog.displayName,
        verified: rewardCatalog.verified,
        firstSeenRunId: rewardCatalog.firstSeenRunId,
        firstSeenOwnerId: run.ownerId,
      })
      .from(rewardCatalog)
      .leftJoin(run, eq(rewardCatalog.firstSeenRunId, run.id))
      .orderBy(asc(rewardCatalog.displayName)),
    db
      .select({ catalogId: upgradeEntry.upgradeCatalogId, refCount: count() })
      .from(upgradeEntry)
      .where(isNotNull(upgradeEntry.upgradeCatalogId))
      .groupBy(upgradeEntry.upgradeCatalogId),
    db
      .select({ catalogId: rewardEntry.rewardCatalogId, refCount: count() })
      .from(rewardEntry)
      .groupBy(rewardEntry.rewardCatalogId),
    db
      .select({
        catalogKind: catalogAlias.catalogKind,
        aliasKey: catalogAlias.aliasKey,
        upgradeCatalogId: catalogAlias.upgradeCatalogId,
        rewardCatalogId: catalogAlias.rewardCatalogId,
      })
      .from(catalogAlias),
  ])

  const refsOf = (rows: { catalogId: string | null; refCount: number }[]) =>
    new Map(rows.flatMap((r) => (r.catalogId ? [[r.catalogId, r.refCount] as const] : [])))
  const upgradeRefCount = refsOf(upgradeRefs)
  const rewardRefCount = refsOf(rewardRefs)

  const aliasesOf = (kind: CatalogKind) => {
    const map = new Map<string, string[]>()
    for (const a of aliases) {
      if (a.catalogKind !== kind) continue
      const target = kind === 'upgrade' ? a.upgradeCatalogId : a.rewardCatalogId
      if (!target) continue
      map.set(target, [...(map.get(target) ?? []), a.aliasKey])
    }
    return map
  }
  const upgradeAliases = aliasesOf('upgrade')
  const rewardAliases = aliasesOf('reward')

  const decorate = (
    row: {
      id: string
      canonicalKey: string
      displayName: string
      verified: boolean
      firstSeenRunId: string | null
      firstSeenOwnerId: string | null
      kind?: 'contract' | 'opportunity_upgrade'
    },
    kind: CatalogKind,
    refCounts: Map<string, number>,
    aliasMap: Map<string, string[]>,
  ): ManagedCatalogRow => {
    const refCount = refCounts.get(row.id) ?? 0
    const rowAliases = aliasMap.get(row.id) ?? []
    return {
      id: row.id,
      canonicalKey: row.canonicalKey,
      displayName: row.displayName,
      kind: row.kind ?? null,
      verified: row.verified,
      ...firstSeenLink(row.firstSeenRunId, row.firstSeenOwnerId, viewerId),
      refCount,
      aliases: rowAliases,
      inSeed: SEED_KEYS[kind].has(row.canonicalKey),
      orphan: isOrphan(
        {
          canonicalKey: row.canonicalKey,
          verified: row.verified,
          refCount,
          aliasCount: rowAliases.length,
        },
        kind,
      ),
    }
  }

  return {
    upgrades: upgradeRows.map((r) => decorate(r, 'upgrade', upgradeRefCount, upgradeAliases)),
    rewards: rewardRows.map((r) => decorate(r, 'reward', rewardRefCount, rewardAliases)),
  }
}
