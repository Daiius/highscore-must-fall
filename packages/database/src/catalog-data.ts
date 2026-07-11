// カタログ名称リストの正典。**DB に依存しない**（seed.ts から切り出し）。
//
// seed.ts は import した時点で DB クライアントを起動するため、テストから名前集合だけを
// 読めるようにこのモジュールへ分離した。実際の投入は seed.ts が行う。
//
// 各エントリは `evidence` を持つ（prd/08-catalog-lifecycle.md §3）:
//   - 'contracts-04' 等 … 突合した prd/samples/ の画像名（拡張子なし）。**verified はこの導出値**。
//   - null            … スクショ未検証の仮登録。読み取りミスが疑われる名称はここにも入れない
//                        （ローカル疑義リストで管理し、検証後に昇格）。
// 昇格（evidence を書く）は必ず PR を通す。UI からは verify できない（prd/08 §5）。
// リロール名（DIGITIZE CONSCIOUSNESS / LIVE UNDERGROUND 等）は upgrade に入れない。
// Steam 実績名は reward に混ぜない。
//
// 系統分類は shared の series.ts が持つ（seed ⊆ series を __tests__/catalog-seed.test.ts で強制）。
// evidence の実在（seed ⊆ samples）も同テストが強制する。

// kind 既定は contract。OU（opportunity_upgrade）は seed を正典として与える
// （prd/03 §3.5・rules/database.md）。本番では unverified 自動登録が既定の contract を
// 書き込むため、OU をここに列挙して再 seed で矯正する。
export type UpgradeKind = 'contract' | 'opportunity_upgrade'

/** 突合した prd/samples/ の画像名（拡張子なし）。null = スクショ未検証の仮登録。 */
export type Evidence = string | null

export interface UpgradeSeed {
  name: string
  kind?: UpgradeKind
  evidence: Evidence
}

export interface RewardSeed {
  name: string
  evidence: Evidence
}

/** verified は evidence の導出値。フラグを独立に持たない（prd/08 §3）。 */
export function isVerified(entry: { evidence: Evidence }): boolean {
  return entry.evidence !== null
}

export const UPGRADES: readonly UpgradeSeed[] = [
  // contracts.png（16種）
  { name: 'NUCLEAR WEAPONS LAB', evidence: 'contracts' },
  { name: 'RATIONED WARHEADS', evidence: 'contracts' },
  { name: 'INCREASE PRODUCTION', evidence: 'contracts' },
  { name: 'ARC FLAIL', evidence: 'contracts' },
  { name: 'INCREASE FIRE RATE', evidence: 'contracts' },
  { name: 'REGENERATIVE SHIELD', evidence: 'contracts' },
  { name: 'BLACKOUT PROTOCOL', evidence: 'contracts' },
  { name: 'INSTITUTE OF AUTOMATION', evidence: 'contracts' },
  { name: 'DEPLOY LASER WATCHTOWER', evidence: 'contracts' },
  { name: 'PLASMA PHYSICS LAB', evidence: 'contracts' },
  { name: 'OPTIMIZED OPERATIONS', evidence: 'contracts' },
  { name: 'ADVANCED MATERIALS LAB', evidence: 'contracts' },
  { name: 'EXTENDED FLAIL', evidence: 'contracts' },
  { name: 'CONTEXT SWITCH', kind: 'opportunity_upgrade', evidence: 'contracts' },
  { name: 'OFFENSIVE INNOVATION CENTER', evidence: 'contracts' },
  { name: 'COBALT COIL GUN', evidence: 'contracts' },
  // contracts-02.png（coil 経路の run。13種）
  { name: 'STOCKPILE NUKES', evidence: 'contracts-02' },
  { name: 'COMBO ARC FLAIL', evidence: 'contracts-02' },
  { name: 'RAPID ARC FLAIL', evidence: 'contracts-02' },
  { name: 'INCREASE FLAIL AMPERES', evidence: 'contracts-02' },
  { name: 'HIGH FREQUENCY LASER', evidence: 'contracts-02' },
  { name: 'INCREASE COIL RATE', evidence: 'contracts-02' },
  { name: 'GRAPHENE TIPPED RODS', evidence: 'contracts-02' },
  { name: 'PRIORITY CHARGING', evidence: 'contracts-02' },
  { name: 'RICOCHET MUNITIONS', evidence: 'contracts-02' },
  { name: 'SUPERCONDUCTING FLAIL', evidence: 'contracts-02' },
  { name: 'STRATOSPHERIC FLAIL', evidence: 'contracts-02' },
  { name: 'BLACKOUT SURGE AGREEMENT', evidence: 'contracts-02' },
  { name: 'RAPID REGENERATION', evidence: 'contracts-02' },
  // contracts-03.png（volley 経路の run。13種）
  { name: 'IMPROVE GIMBAL SPEED', evidence: 'contracts-03' },
  { name: 'VOLLEY RAILGUN', evidence: 'contracts-03' },
  { name: 'TRIPLE VOLLEY RAILGUN', evidence: 'contracts-03' },
  { name: 'QUAD VOLLEY RAILGUN', evidence: 'contracts-03' },
  { name: 'PENT VOLLEY RAILGUN', evidence: 'contracts-03' },
  { name: 'ANTIMATTER WARHEADS', evidence: 'contracts-03' },
  { name: 'SUPERCONDUCTING POWER LINES', evidence: 'contracts-03' },
  { name: 'EXTENDED PLASMA DECAY', evidence: 'contracts-03' },
  { name: 'DEPLOY DRONE FACTORY', evidence: 'contracts-03' },
  { name: 'DOUBLE-BARRELLED DRONES', evidence: 'contracts-03' },
  { name: 'EFFICIENT RELOADING', evidence: 'contracts-03' },
  { name: 'BULKY PROJECTILES', kind: 'opportunity_upgrade', evidence: 'contracts-03' },
  { name: 'EXTENDED SENSOR RANGE', kind: 'opportunity_upgrade', evidence: 'contracts-03' },
  // contracts-04.png（blunderbuss 経路の run。9種）。主砲の第4経路 GARBAGE BLUNDERBUSS と
  // その強化、および本番で kind=contract として自動登録されていた OU 3種（再 seed で矯正される）。
  // TWIN DRONE FACTORY は contracts-03 にも写るが、bot の誤読（THIN）が起きたのはこの画像なので
  // ここを根拠にする（prd/08 §8）。
  { name: 'TWIN DRONE FACTORY', evidence: 'contracts-04' },
  { name: 'GARBAGE BLUNDERBUSS', evidence: 'contracts-04' },
  { name: 'DELUXE TRASH COMPACTOR', evidence: 'contracts-04' },
  { name: 'QUAD BLUNDERBUSS', evidence: 'contracts-04' },
  { name: 'PENT BLUNDERBUSS', evidence: 'contracts-04' },
  { name: 'REFINED BLAST CHAMBERS', evidence: 'contracts-04' },
  { name: 'SLEEPER PROTOCOL', kind: 'opportunity_upgrade', evidence: 'contracts-04' },
  { name: 'IN-FLIGHT REPAIRS', kind: 'opportunity_upgrade', evidence: 'contracts-04' },
  { name: 'ADVANCED DRONE SYSTEMS', kind: 'opportunity_upgrade', evidence: 'contracts-04' },
  // 実測 run 由来の仮登録（6種）
  { name: 'EXTENDED BARREL', evidence: null },
  { name: 'HARDENED SPLINTERS', evidence: null },
  { name: 'INCREASE BUNDLING RATE', evidence: null },
  { name: 'PIVOT RELOAD', kind: 'opportunity_upgrade', evidence: null },
  { name: 'SPLINTERING POLES', evidence: null },
  { name: 'TELEGRAPH BASILISK', evidence: null },
  // 本番カタログに unverified 自動登録されていた仮登録（4種・スクショ未取得）。
  // EXPANDED SHIELD NETWORK はガイドで OU と判明しているため kind を与える。
  { name: 'EXPANDED SHIELD NETWORK', kind: 'opportunity_upgrade', evidence: null },
  { name: 'PULSE REFLEX', evidence: null },
  { name: 'SHIELD BLAST', evidence: null },
  { name: 'ROBOTICS SPECIALIST', evidence: null },
]

export const REWARDS: readonly RewardSeed[] = [
  // rewards.png（13種）
  { name: 'BOHEMIAN', evidence: 'rewards' },
  { name: 'OBSESSIVE', evidence: 'rewards' },
  { name: "CHEF'S KISS", evidence: 'rewards' },
  { name: 'CONSERVATION', evidence: 'rewards' },
  { name: 'NO ESCAPE', evidence: 'rewards' },
  { name: 'LASER DISCO', evidence: 'rewards' },
  { name: 'DISCIPLINE', evidence: 'rewards' },
  { name: 'ANNIHILATION', evidence: 'rewards' },
  { name: 'COMPLETIST', evidence: 'rewards' },
  { name: 'MINT CONDITION', evidence: 'rewards' },
  { name: 'GONNAHAVEMESOMEFUN', evidence: 'rewards' },
  { name: 'HARD CHEESE', evidence: 'rewards' },
  { name: 'CLOSE SHAVE', evidence: 'rewards' },
  // rewards-02.png（12種）
  { name: 'BUSY DAY', evidence: 'rewards-02' },
  { name: 'CALAMARI FRITTI', evidence: 'rewards-02' },
  { name: 'CARPET BOMBER', evidence: 'rewards-02' },
  { name: 'COMMANDO', evidence: 'rewards-02' },
  { name: 'DOUBLE RAINBOW', evidence: 'rewards-02' },
  { name: 'EGGS ROYALE', evidence: 'rewards-02' },
  { name: 'HARD BOILED', evidence: 'rewards-02' },
  { name: 'MR. CREOSOTE', evidence: 'rewards-02' },
  { name: 'NOT SO FAST', evidence: 'rewards-02' },
  { name: 'SEAFOOD PLATTER', evidence: 'rewards-02' },
  { name: 'SORTED', evidence: 'rewards-02' },
  { name: 'TOASTY', evidence: 'rewards-02' },
  // rewards-03.png（3種）
  { name: 'GOOD DOG', evidence: 'rewards-03' },
  { name: "IT'S A SHINY!", evidence: 'rewards-03' },
  { name: 'SHAPE ROTATOR', evidence: 'rewards-03' },
  // 実測 run 由来の仮登録（2種）
  { name: 'FIRECRACKER', evidence: null },
  { name: "LINE'EM UP LLOYD", evidence: null },
]
