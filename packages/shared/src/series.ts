// アップグレード（contract）の系統（series）分類。実験的機能（prd/06 Phase2 の前倒し / prd/01 §3.2）。
//
// 出典は二次情報の Steam ガイド「Utopia Must Learn : A superguide for UMF」
// （https://steamcommunity.com/sharedfiles/filedetails/?id=3433239569）＋ 一次情報スクショとの突合。
// **文字色は系統を示さない**（prd/samples/contracts-04.png で反証: INCREASE FIRE RATE(主砲) と
// STOCKPILE NUKES(核) が同じ黄、ANTIMATTER WARHEADS(核) と REGENERATIVE SHIELD(シールド) が同じ青）。
// 色が何を示すか（レアリティ/階層）は未確定（prd/01 §9）。
// 未知名は 'unknown'（未分類）に落とす（分類の穴が UI 上で見えるように）。
//
// キーは正規形（normalizeName 済み）。テストで正規形安定性を担保する。

export const UPGRADE_SERIES_KEYS = [
  'railgun',
  'nuke',
  'shield',
  'flail',
  'automation',
  'opportunity',
  'unknown',
] as const
export type UpgradeSeries = (typeof UPGRADE_SERIES_KEYS)[number]

export const UPGRADE_SERIES_LABELS: Record<UpgradeSeries, string> = {
  railgun: 'レールガン（主砲）',
  nuke: '核兵器',
  shield: 'シールド',
  flail: 'フレイル',
  automation: '自動防衛（タワー/ドローン）',
  opportunity: 'OU（機会アップグレード）',
  unknown: '未分類',
}

/**
 * 正規名 → 系統。ガイド由来のため実際の出現名と揺れる可能性があり、
 * 未収載・不確かな名前は登録しない（unknown 扱いにして可視化する）。
 */
export const UPGRADE_SERIES_BY_NAME: Record<string, UpgradeSeries> = {
  // レールガン（主砲）系。OFFENSIVE INNOVATION CENTER の直後に4経路から1つを選び、
  // 選んだ経路は run 内で排他（実データで検証済み）。経路の内訳は次の PR で branch として型化する。
  //   volley      : VOLLEY RAILGUN → TRIPLE → QUAD → PENT
  //   coil        : COBALT COIL GUN 配下（GRAPHENE TIPPED RODS / RICOCHET MUNITIONS はここ）
  //   basilisk    : TELEGRAPH BASILISK 配下（BUNDLING/SPLINTER 系はここ。独立経路ではない）
  //   blunderbuss : GARBAGE BLUNDERBUSS 配下
  //   共通        : 分岐前に取る強化（EXTENDED BARREL / IMPROVE GIMBAL SPEED）。
  //                 INCREASE FIRE RATE は分岐前・分岐後の双方で取得できる（文脈依存）。
  'VOLLEY RAILGUN': 'railgun',
  'TRIPLE VOLLEY RAILGUN': 'railgun',
  'QUAD VOLLEY RAILGUN': 'railgun',
  'PENT VOLLEY RAILGUN': 'railgun',
  'EXTENDED BARREL': 'railgun',
  'IMPROVE GIMBAL SPEED': 'railgun',
  'INCREASE FIRE RATE': 'railgun',
  'EFFICIENT RELOADING': 'railgun',
  'COBALT COIL GUN': 'railgun',
  'INCREASE COIL RATE': 'railgun',
  'RICOCHET MUNITIONS': 'railgun',
  'GRAPHENE TIPPED RODS': 'railgun',
  'TELEGRAPH BASILISK': 'railgun',
  'INCREASE BUNDLING RATE': 'railgun',
  'OVERWEIGHT BUNDLES': 'railgun',
  'SPLINTERING POLES': 'railgun',
  'HARDENED SPLINTERS': 'railgun',
  'GARBAGE BLUNDERBUSS': 'railgun',
  'DELUXE TRASH COMPACTOR': 'railgun',
  'QUAD BLUNDERBUSS': 'railgun',
  'PENT BLUNDERBUSS': 'railgun',
  // 核兵器系（NUCLEAR WEAPONS LAB 配下）
  'NUCLEAR WEAPONS LAB': 'nuke',
  'STOCKPILE NUKES': 'nuke',
  'INCREASE PRODUCTION': 'nuke',
  'URANIUM STRIP MINING': 'nuke',
  'RATIONED WARHEADS': 'nuke',
  'ANTIMATTER WARHEADS': 'nuke',
  'EXTENDED PLASMA DECAY': 'nuke',
  'OVER-FUELLED BOOSTERS': 'nuke',
  // シールド系（PLASMA PHYSICS LAB 配下）
  'PLASMA PHYSICS LAB': 'shield',
  'REGENERATIVE SHIELD': 'shield',
  'RAPID REGENERATION': 'shield',
  'PRIORITY CHARGING': 'shield',
  'SHIELD BLAST': 'shield',
  'PULSE REFLEX': 'shield',
  'BLACKOUT PROTOCOL': 'shield',
  'BLACKOUT SURGE AGREEMENT': 'shield',
  // フレイル系（ガイドでは PLASMA PHYSICS LAB 配下だが分析上は独立系統として扱う）
  'ARC FLAIL': 'flail',
  'EXTENDED FLAIL': 'flail',
  'RAPID ARC FLAIL': 'flail',
  'COMBO ARC FLAIL': 'flail',
  'SUPERCONDUCTING FLAIL': 'flail',
  'STRATOSPHERIC FLAIL': 'flail',
  'INCREASE FLAIL AMPERES': 'flail',
  // 自動防衛系（INSTITUTE OF AUTOMATION 配下: レーザー塔 / ドローン）
  'INSTITUTE OF AUTOMATION': 'automation',
  'DEPLOY LASER WATCHTOWER': 'automation',
  'HIGH FREQUENCY LASER': 'automation',
  'Q-DISRUPTOR TOWER': 'automation',
  'DEPLOY DRONE FACTORY': 'automation',
  'TWIN DRONE FACTORY': 'automation',
  'THIN DRONE FACTORY': 'automation',
  'DOUBLE-BARRELLED DRONES': 'automation',
  // OU（ガイド掲載の20種。UPGRADE HISTORY に載るものだけが記録に現れる）
  'CHEAP NUKES': 'opportunity',
  'WORK RETREAT': 'opportunity',
  'SLEEPER PROTOCOL': 'opportunity',
  'ILLICIT ARMS DEAL': 'opportunity',
  'OPERATION HERMIT': 'opportunity',
  'CONTEXT SWITCH': 'opportunity',
  'FLARE LINK PRIORITY': 'opportunity',
  'PIVOT RELOAD': 'opportunity',
  'IN-FLIGHT REPAIRS': 'opportunity',
  'HUMAN CLONING FACILITY': 'opportunity',
  'LIQUIDATE SHIELD NODES': 'opportunity',
  'BERSERKER CHARTER': 'opportunity',
  'BULKY PROJECTILES': 'opportunity',
  'REFUGEE ASYLUM SCHEME': 'opportunity',
  'SLAPDASH CONSTRUCTION': 'opportunity',
  'EXTENDED SENSOR RANGE': 'opportunity',
  'MAINTENANCE WORKS': 'opportunity',
  'RED FLAG DAY': 'opportunity',
  'ADVANCED DRONE SYSTEMS': 'opportunity',
  'EXPANDED SHIELD NETWORK': 'opportunity',
  // ユーザー確認済みの分類（2026-07-05）:
  //   OFFENSIVE INNOVATION CENTER = 主砲4経路への分岐前提 → railgun
  //   OPTIMIZED OPERATIONS = ドローン/レーザータワーの修復高速化 → automation
  'OFFENSIVE INNOVATION CENTER': 'railgun',
  'OPTIMIZED OPERATIONS': 'automation',
}

/**
 * 系統を **意図的に** 割り当てない正規名。「まだ調べていない穴」と「調べた上で属さないと決めた名前」を
 * 区別するために明示する。カタログ seed の全名称は、このどちらか（分類済み or ここ）に載る必要がある
 * （database の __tests__/catalog-seed.test.ts が強制）。
 */
export const UPGRADE_SERIES_INTENTIONALLY_UNCLASSIFIED: ReadonlySet<string> = new Set([
  // 全分野に跨る高度技術の解放前提。特定系統に属さない（ユーザー確認済み）。
  'ADVANCED MATERIALS LAB',
  // ガイドの系統ツリーに無い。実測 run では出現するが所属不明。
  'SUPERCONDUCTING POWER LINES',
  'ROBOTICS SPECIALIST',
  // sample-04 で観測。名前は核（blast chambers）にもシールド（plasma）にも読め、未確定。
  'REFINED BLAST CHAMBERS',
])

/** 正規名から系統を引く。未収載は 'unknown'。 */
export function upgradeSeriesOf(name: string): UpgradeSeries {
  return UPGRADE_SERIES_BY_NAME[name] ?? 'unknown'
}
