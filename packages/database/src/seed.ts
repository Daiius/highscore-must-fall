// 初期カタログのシード投入。冪等（何度流しても canonical_key で upsert）。
//
// 初期 seed = サンプル由来のみ（prd/01-game-domain.md §7）:
//   - upgrade_catalog: 16 種（リロール名 DIGITIZE CONSCIOUSNESS 等は含めない）
//   - reward_catalog : 13 種（Steam 実績名は混ぜない）
// 正規名は shared の normalizeName を通す（正規形をそのまま canonical_key かつ display_name に使う）。

import { normalizeName } from 'shared'
import { client, db, rewardCatalog, upgradeCatalog } from './index'

// prd/01 §7.1（WEEK1/WEEK2 由来・計16）。DEPLOY LASER WATCHTOWER は重複出現だが1エントリ。
// kind 既定は contract。CONTEXT SWITCH のみ opportunity_upgrade（OU。ラン跨ぎ恒久解禁の
// メタ進行。prd/03 §3.5・.claude/rules/database.md）。seed はこの既知分類を正典として与える。
type UpgradeKind = 'contract' | 'opportunity_upgrade'
const UPGRADES: readonly { name: string; kind: UpgradeKind }[] = [
  { name: 'NUCLEAR WEAPONS LAB', kind: 'contract' },
  { name: 'RATIONED WARHEADS', kind: 'contract' },
  { name: 'INCREASE PRODUCTION', kind: 'contract' },
  { name: 'ARC FLAIL', kind: 'contract' },
  { name: 'INCREASE FIRE RATE', kind: 'contract' },
  { name: 'REGENERATIVE SHIELD', kind: 'contract' },
  { name: 'BLACKOUT PROTOCOL', kind: 'contract' },
  { name: 'INSTITUTE OF AUTOMATION', kind: 'contract' },
  { name: 'DEPLOY LASER WATCHTOWER', kind: 'contract' },
  { name: 'PLASMA PHYSICS LAB', kind: 'contract' },
  { name: 'OPTIMIZED OPERATIONS', kind: 'contract' },
  { name: 'ADVANCED MATERIALS LAB', kind: 'contract' },
  { name: 'EXTENDED FLAIL', kind: 'contract' },
  { name: 'CONTEXT SWITCH', kind: 'opportunity_upgrade' },
  { name: 'OFFENSIVE INNOVATION CENTER', kind: 'contract' },
  { name: 'COBALT COIL GUN', kind: 'contract' },
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

/** upgrade を canonical_key で重複排除した seed 行（kind 付き）に変換する。 */
function toUpgradeRows(items: readonly { name: string; kind: UpgradeKind }[]) {
  // 正規形は表示にもそのまま使う（別の表示名を持たない）。seed は人手キュレーション済み＝verified。
  const byKey = new Map<string, { canonicalKey: string; displayName: string; kind: UpgradeKind }>()
  for (const { name, kind } of items) {
    const key = normalizeName(name)
    byKey.set(key, { canonicalKey: key, displayName: key, kind })
  }
  return [...byKey.values()].map((row) => ({ ...row, verified: true }))
}

/** reward 名を canonical_key で重複排除した seed 行に変換する。 */
function toRewardRows(names: readonly string[]) {
  const keys = new Set<string>()
  for (const name of names) keys.add(normalizeName(name))
  return [...keys].map((key) => ({ canonicalKey: key, displayName: key, verified: true }))
}

async function main() {
  const upgradeRows = toUpgradeRows(UPGRADES)
  const rewardRows = toRewardRows(REWARD_NAMES)

  for (const row of upgradeRows) {
    await db
      .insert(upgradeCatalog)
      .values(row)
      // kind も seed を正典として上書き（再 seed で既知分類のドリフトを戻す）。
      .onDuplicateKeyUpdate({
        set: { displayName: row.displayName, kind: row.kind, verified: true },
      })
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
