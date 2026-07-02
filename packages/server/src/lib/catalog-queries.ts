// カタログ読み取りクエリ層。カタログはグローバル（owner を持たない）。prd/03 §5。
// 一覧は表示名昇順。verify/マージ（Task 8）や分析の名寄せ表示に使う。

import { db, rewardCatalog, upgradeCatalog } from 'database'
import { asc } from 'drizzle-orm'

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
