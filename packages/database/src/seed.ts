// カタログのシード投入。冪等（何度流しても canonical_key で upsert）。
//
// カタログは「投入値はこのリストから選ぶ」母集団が基本で、未知名の unverified 自動登録は
// ゲーム更新にカタログ整備が追いつかない期間の補助（prd/01-game-domain.md §7）。
// 名称リストの正典は ./catalog-data.ts（DB 非依存。テストから読めるよう分離）。
// 正規名は shared の normalizeName を通す（正規形をそのまま canonical_key かつ display_name に使う）。

import { normalizeName } from 'shared'
import {
  isVerified,
  REWARDS,
  type RewardSeed,
  UPGRADES,
  type UpgradeKind,
  type UpgradeSeed,
} from './catalog-data'
import { client, db, rewardCatalog, upgradeCatalog } from './index'

// DB の verified は seed の evidence の投影（DB に evidence は持たせない。prd/08 §3）。

/** upgrade を canonical_key で重複排除した seed 行（kind 付き）に変換する。 */
function toUpgradeRows(items: readonly UpgradeSeed[]) {
  // 正規形は表示にもそのまま使う（別の表示名を持たない）。
  const byKey = new Map<
    string,
    { canonicalKey: string; displayName: string; kind: UpgradeKind; verified: boolean }
  >()
  for (const item of items) {
    const key = normalizeName(item.name)
    byKey.set(key, {
      canonicalKey: key,
      displayName: key,
      kind: item.kind ?? 'contract',
      verified: isVerified(item),
    })
  }
  return [...byKey.values()]
}

/** reward を canonical_key で重複排除した seed 行に変換する。 */
function toRewardRows(items: readonly RewardSeed[]) {
  const byKey = new Map<string, { canonicalKey: string; displayName: string; verified: boolean }>()
  for (const item of items) {
    const key = normalizeName(item.name)
    byKey.set(key, { canonicalKey: key, displayName: key, verified: isVerified(item) })
  }
  return [...byKey.values()]
}

async function main() {
  const upgradeRows = toUpgradeRows(UPGRADES)
  const rewardRows = toRewardRows(REWARDS)

  for (const row of upgradeRows) {
    await db
      .insert(upgradeCatalog)
      .values(row)
      .onDuplicateKeyUpdate({
        // kind は常に seed を正典として上書き（再 seed で既知分類のドリフトを戻す）。
        // verified は verified 行のみ昇格させ、仮登録行では既存値を保護する
        // （人手 verify の結果を再 seed で降格させない）。
        set: row.verified
          ? { displayName: row.displayName, kind: row.kind, verified: true }
          : { displayName: row.displayName, kind: row.kind },
      })
  }
  for (const row of rewardRows) {
    await db
      .insert(rewardCatalog)
      .values(row)
      .onDuplicateKeyUpdate({
        set: row.verified
          ? { displayName: row.displayName, verified: true }
          : { displayName: row.displayName },
      })
  }

  const uv = upgradeRows.filter((r) => r.verified).length
  const rv = rewardRows.filter((r) => r.verified).length
  console.log(
    `seeded: upgrade_catalog=${upgradeRows.length} (verified=${uv}), ` +
      `reward_catalog=${rewardRows.length} (verified=${rv})`,
  )
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
