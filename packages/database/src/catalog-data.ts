// カタログ名称リストの正典。**DB に依存しない**（seed.ts から切り出し）。
//
// seed.ts は import した時点で DB クライアントを起動するため、テストから名前集合だけを
// 読めるようにこのモジュールへ分離した。実際の投入は seed.ts が行う。
//
// 区分:
//   - verified: true  … スクショ一次情報（prd/samples/*.png）と突合済みの名称。
//   - verified: false … 実測 run 由来でスクショ未検証の仮登録。読み取りミスが疑われる名称は
//                        ここに入れない（ローカル疑義リストで管理し、検証後に昇格）。
// リロール名（DIGITIZE CONSCIOUSNESS / LIVE UNDERGROUND 等）は upgrade に入れない。
// Steam 実績名は reward に混ぜない。
//
// 系統分類は shared の series.ts が持つ（seed ⊆ series を __tests__/catalog-seed.test.ts で強制）。

// kind 既定は contract。OU（opportunity_upgrade）は seed を正典として与える
// （prd/03 §3.5・rules/database.md）。本番では unverified 自動登録が既定の contract を
// 書き込むため、OU をここに列挙して再 seed で矯正する。
export type UpgradeKind = 'contract' | 'opportunity_upgrade'

export interface UpgradeSeed {
  name: string
  kind?: UpgradeKind
  verified: boolean
}

export interface RewardSeed {
  name: string
  verified: boolean
}

// スクショ検証済み（sample-01〜04: prd/samples/*.png）。
const VERIFIED = { verified: true } as const
// スクショ未検証の仮登録（実測 run 由来 / 二次情報のガイド由来）。
const PROVISIONAL = { verified: false } as const

export const UPGRADES: readonly UpgradeSeed[] = [
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
  { name: 'BULKY PROJECTILES', kind: 'opportunity_upgrade', ...VERIFIED },
  { name: 'EXTENDED SENSOR RANGE', kind: 'opportunity_upgrade', ...VERIFIED },
  // sample-04 由来（8種）。主砲の第4経路 GARBAGE BLUNDERBUSS とその強化、および
  // 本番で kind=contract として自動登録されていた OU 3種（再 seed で矯正される）。
  { name: 'GARBAGE BLUNDERBUSS', ...VERIFIED },
  { name: 'DELUXE TRASH COMPACTOR', ...VERIFIED },
  { name: 'QUAD BLUNDERBUSS', ...VERIFIED },
  { name: 'PENT BLUNDERBUSS', ...VERIFIED },
  { name: 'REFINED BLAST CHAMBERS', ...VERIFIED },
  { name: 'SLEEPER PROTOCOL', kind: 'opportunity_upgrade', ...VERIFIED },
  { name: 'IN-FLIGHT REPAIRS', kind: 'opportunity_upgrade', ...VERIFIED },
  { name: 'ADVANCED DRONE SYSTEMS', kind: 'opportunity_upgrade', ...VERIFIED },
  // 実測 run 由来の仮登録（6種）
  { name: 'EXTENDED BARREL', ...PROVISIONAL },
  { name: 'HARDENED SPLINTERS', ...PROVISIONAL },
  { name: 'INCREASE BUNDLING RATE', ...PROVISIONAL },
  { name: 'PIVOT RELOAD', kind: 'opportunity_upgrade', ...PROVISIONAL },
  { name: 'SPLINTERING POLES', ...PROVISIONAL },
  { name: 'TELEGRAPH BASILISK', ...PROVISIONAL },
  // 本番カタログに unverified 自動登録されていた仮登録（4種・スクショ未取得）。
  // EXPANDED SHIELD NETWORK はガイドで OU と判明しているため kind を与える。
  { name: 'EXPANDED SHIELD NETWORK', kind: 'opportunity_upgrade', ...PROVISIONAL },
  { name: 'PULSE REFLEX', ...PROVISIONAL },
  { name: 'SHIELD BLAST', ...PROVISIONAL },
  { name: 'ROBOTICS SPECIALIST', ...PROVISIONAL },
]

export const REWARDS: readonly RewardSeed[] = [
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
