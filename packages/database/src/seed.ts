// 初期カタログのシード投入。冪等（何度流しても canonical_key で upsert）。
//
// 初期 seed = サンプル由来のみ（prd/01-game-domain.md §7）:
//   - upgrade_catalog: 16 種（リロール名 DIGITIZE CONSCIOUSNESS 等は含めない）
//   - reward_catalog : 13 種（Steam 実績名は混ぜない）
// 正規名は shared の normalizeName を通す（正規形をそのまま canonical_key かつ display_name に使う）。

import { normalizeName } from 'shared'
import { client, db, rewardCatalog, upgradeCatalog } from './index'

// prd/01 §7.1（WEEK1/WEEK2 由来・計16）。DEPLOY LASER WATCHTOWER は重複出現だが1エントリ。
const UPGRADE_NAMES = [
  'NUCLEAR WEAPONS LAB',
  'RATIONED WARHEADS',
  'INCREASE PRODUCTION',
  'ARC FLAIL',
  'INCREASE FIRE RATE',
  'REGENERATIVE SHIELD',
  'BLACKOUT PROTOCOL',
  'INSTITUTE OF AUTOMATION',
  'DEPLOY LASER WATCHTOWER',
  'PLASMA PHYSICS LAB',
  'OPTIMIZED OPERATIONS',
  'ADVANCED MATERIALS LAB',
  'EXTENDED FLAIL',
  'CONTEXT SWITCH',
  'OFFENSIVE INNOVATION CENTER',
  'COBALT COIL GUN',
]

// prd/01 §7.2（計13）。
const REWARD_NAMES = [
  'BOHEMIAN',
  'OBSESSIVE',
  "CHEF'S KISS",
  'CONSERVATION',
  'NO ESCAPE',
  'LASER DISCO',
  'DISCIPLINE',
  'ANNIHILATION',
  'COMPLETIST',
  'MINT CONDITION',
  'GONNAHAVEMESOMEFUN',
  'HARD CHEESE',
  'CLOSE SHAVE',
]

/** 名前配列を canonical_key で重複排除した seed 行に変換する。 */
function toCatalogRows(names: readonly string[]) {
  const keys = new Set<string>()
  for (const name of names) keys.add(normalizeName(name))
  // 正規形は表示にもそのまま使う（別の表示名を持たない）。seed は人手キュレーション済み＝verified。
  return [...keys].map((key) => ({ canonicalKey: key, displayName: key, verified: true }))
}

async function main() {
  const upgradeRows = toCatalogRows(UPGRADE_NAMES)
  const rewardRows = toCatalogRows(REWARD_NAMES)

  for (const row of upgradeRows) {
    await db
      .insert(upgradeCatalog)
      .values(row)
      .onDuplicateKeyUpdate({ set: { displayName: row.displayName, verified: true } })
  }
  for (const row of rewardRows) {
    await db
      .insert(rewardCatalog)
      .values(row)
      .onDuplicateKeyUpdate({ set: { displayName: row.displayName, verified: true } })
  }

  console.log(`seeded: upgrade_catalog=${upgradeRows.length}, reward_catalog=${rewardRows.length}`)
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
