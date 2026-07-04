// カタログのシード投入。冪等（何度流しても canonical_key で upsert）。
//
// カタログは「投入値はこのリストから選ぶ」母集団が基本で、未知名の unverified 自動登録は
// ゲーム更新にカタログ整備が追いつかない期間の補助（prd/01-game-domain.md §7）。
// この seed が名称リストの正典:
//   - verified: true  … スクショ一次情報（prd/samples/*.png）と突合済みの名称。
//   - verified: false … 実測 run 由来でスクショ未検証の仮登録。読み取りミスが疑われる名称は
//                        seed に入れない（ローカル疑義リストで管理し、検証後に昇格）。
// リロール名（DIGITIZE CONSCIOUSNESS 等）は upgrade に入れない。Steam 実績名は reward に混ぜない。
// 正規名は shared の normalizeName を通す（正規形をそのまま canonical_key かつ display_name に使う）。

import { normalizeName } from 'shared'
import { client, db, rewardCatalog, upgradeCatalog } from './index'

// kind 既定は contract。CONTEXT SWITCH のみ opportunity_upgrade（OU。ラン跨ぎ恒久解禁の
// メタ進行。prd/03 §3.5・.claude/rules/database.md）。seed はこの既知分類を正典として与える。
type UpgradeKind = 'contract' | 'opportunity_upgrade'
interface UpgradeSeed {
  name: string
  kind?: UpgradeKind
  verified: boolean
}

// スクショ検証済み（sample-01〜03: prd/samples/{contracts,rewards}*.png）。
const VERIFIED = { verified: true } as const
// 実測 run 由来・スクショ未検証の仮登録（2026-07-04 開発環境 DB より）。
const PROVISIONAL = { verified: false } as const

const UPGRADES: readonly UpgradeSeed[] = [
  // sample-01 由来（16種）
  { name: 'NUCLEAR WEAPONS LAB', ...VERIFIED },
  { name: 'RATIONED WARHEADS', ...VERIFIED },
  { name: 'INCREASE PRODUCTION', ...VERIFIED },
  { name: 'ARC FLAIL', ...VERIFIED },
  { name: 'INCREASE FIRE RATE', ...VERIFIED },
  { name: 'REGENERATIVE SHIELD', ...VERIFIED },
  { name: 'BLACKOUT PROTOCOL', ...VERIFIED },
  { name: 'INSTITUTE OF AUTOMATION', ...VERIFIED },
  { name: 'DEPLOY LASER WATCHTOWER', ...VERIFIED },
  { name: 'PLASMA PHYSICS LAB', ...VERIFIED },
  { name: 'OPTIMIZED OPERATIONS', ...VERIFIED },
  { name: 'ADVANCED MATERIALS LAB', ...VERIFIED },
  { name: 'EXTENDED FLAIL', ...VERIFIED },
  { name: 'CONTEXT SWITCH', kind: 'opportunity_upgrade', ...VERIFIED },
  { name: 'OFFENSIVE INNOVATION CENTER', ...VERIFIED },
  { name: 'COBALT COIL GUN', ...VERIFIED },
  // sample-02/03 由来（27種）
  { name: 'STOCKPILE NUKES', ...VERIFIED },
  { name: 'IMPROVE GIMBAL SPEED', ...VERIFIED },
  { name: 'COMBO ARC FLAIL', ...VERIFIED },
  { name: 'RAPID ARC FLAIL', ...VERIFIED },
  { name: 'VOLLEY RAILGUN', ...VERIFIED },
  { name: 'TRIPLE VOLLEY RAILGUN', ...VERIFIED },
  { name: 'QUAD VOLLEY RAILGUN', ...VERIFIED },
  { name: 'PENT VOLLEY RAILGUN', ...VERIFIED },
  { name: 'INCREASE FLAIL AMPERES', ...VERIFIED },
  { name: 'HIGH FREQUENCY LASER', ...VERIFIED },
  { name: 'INCREASE COIL RATE', ...VERIFIED },
  { name: 'GRAPHENE TIPPED RODS', ...VERIFIED },
  { name: 'PRIORITY CHARGING', ...VERIFIED },
  { name: 'RICOCHET MUNITIONS', ...VERIFIED },
  { name: 'SUPERCONDUCTING FLAIL', ...VERIFIED },
  { name: 'STRATOSPHERIC FLAIL', ...VERIFIED },
  { name: 'BLACKOUT SURGE AGREEMENT', ...VERIFIED },
  { name: 'RAPID REGENERATION', ...VERIFIED },
  { name: 'ANTIMATTER WARHEADS', ...VERIFIED },
  { name: 'SUPERCONDUCTING POWER LINES', ...VERIFIED },
  { name: 'EXTENDED PLASMA DECAY', ...VERIFIED },
  { name: 'DEPLOY DRONE FACTORY', ...VERIFIED },
  { name: 'TWIN DRONE FACTORY', ...VERIFIED },
  { name: 'DOUBLE-BARRELLED DRONES', ...VERIFIED },
  { name: 'EFFICIENT RELOADING', ...VERIFIED },
  { name: 'BULKY PROJECTILES', ...VERIFIED },
  { name: 'EXTENDED SENSOR RANGE', ...VERIFIED },
  // 実測 run 由来の仮登録（6種）
  { name: 'EXTENDED BARREL', ...PROVISIONAL },
  { name: 'HARDENED SPLINTERS', ...PROVISIONAL },
  { name: 'INCREASE BUNDLING RATE', ...PROVISIONAL },
  { name: 'PIVOT RELOAD', ...PROVISIONAL },
  { name: 'SPLINTERING POLES', ...PROVISIONAL },
  { name: 'TELEGRAPH BASILISK', ...PROVISIONAL },
]

interface RewardSeed {
  name: string
  verified: boolean
}

const REWARDS: readonly RewardSeed[] = [
  // sample-01 由来（13種）
  { name: 'BOHEMIAN', ...VERIFIED },
  { name: 'OBSESSIVE', ...VERIFIED },
  { name: "CHEF'S KISS", ...VERIFIED },
  { name: 'CONSERVATION', ...VERIFIED },
  { name: 'NO ESCAPE', ...VERIFIED },
  { name: 'LASER DISCO', ...VERIFIED },
  { name: 'DISCIPLINE', ...VERIFIED },
  { name: 'ANNIHILATION', ...VERIFIED },
  { name: 'COMPLETIST', ...VERIFIED },
  { name: 'MINT CONDITION', ...VERIFIED },
  { name: 'GONNAHAVEMESOMEFUN', ...VERIFIED },
  { name: 'HARD CHEESE', ...VERIFIED },
  { name: 'CLOSE SHAVE', ...VERIFIED },
  // sample-02/03 由来（15種）
  { name: 'BUSY DAY', ...VERIFIED },
  { name: 'CALAMARI FRITTI', ...VERIFIED },
  { name: 'CARPET BOMBER', ...VERIFIED },
  { name: 'COMMANDO', ...VERIFIED },
  { name: 'DOUBLE RAINBOW', ...VERIFIED },
  { name: 'EGGS ROYALE', ...VERIFIED },
  { name: 'GOOD DOG', ...VERIFIED },
  { name: 'HARD BOILED', ...VERIFIED },
  { name: "IT'S A SHINY!", ...VERIFIED },
  { name: 'MR. CREOSOTE', ...VERIFIED },
  { name: 'NOT SO FAST', ...VERIFIED },
  { name: 'SEAFOOD PLATTER', ...VERIFIED },
  { name: 'SHAPE ROTATOR', ...VERIFIED },
  { name: 'SORTED', ...VERIFIED },
  { name: 'TOASTY', ...VERIFIED },
  // 実測 run 由来の仮登録（2種）
  { name: 'FIRECRACKER', ...PROVISIONAL },
  { name: "LINE'EM UP LLOYD", ...PROVISIONAL },
]

/** upgrade を canonical_key で重複排除した seed 行（kind 付き）に変換する。 */
function toUpgradeRows(items: readonly UpgradeSeed[]) {
  // 正規形は表示にもそのまま使う（別の表示名を持たない）。
  const byKey = new Map<
    string,
    { canonicalKey: string; displayName: string; kind: UpgradeKind; verified: boolean }
  >()
  for (const { name, kind, verified } of items) {
    const key = normalizeName(name)
    byKey.set(key, { canonicalKey: key, displayName: key, kind: kind ?? 'contract', verified })
  }
  return [...byKey.values()]
}

/** reward を canonical_key で重複排除した seed 行に変換する。 */
function toRewardRows(items: readonly RewardSeed[]) {
  const byKey = new Map<string, { canonicalKey: string; displayName: string; verified: boolean }>()
  for (const { name, verified } of items) {
    const key = normalizeName(name)
    byKey.set(key, { canonicalKey: key, displayName: key, verified })
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
        // verified 行は kind/verified も seed を正典として上書き（再 seed でドリフトを戻す）。
        // 仮登録行は既存の verified/kind を上書きしない（人手 verify の結果を再 seed で壊さない）。
        set: row.verified
          ? { displayName: row.displayName, kind: row.kind, verified: true }
          : { displayName: row.displayName },
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
