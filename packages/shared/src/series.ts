// アップグレード（contract）の分類。prd/01 §3・prd/06 §1.2/§2。
//
// 出典は二次情報の Steam ガイド「Utopia Must Learn : A superguide for UMF」
// （https://steamcommunity.com/sharedfiles/filedetails/?id=3433239569）＋ 一次情報スクショとの突合。
// **文字色は系統を示さない**（prd/samples/contracts-04.png で反証: INCREASE FIRE RATE(主砲) と
// STOCKPILE NUKES(核) が同じ黄、ANTIMATTER WARHEADS(核) と REGENERATIVE SHIELD(シールド) が同じ青）。
// 色が何を示すか（レアリティ/階層）は未確定（prd/01 §9）。
// 未知名は 'unknown'（未分類）に落とす（分類の穴が UI 上で見えるように）。
//
// キーは正規形（normalizeName 済み）。テストで正規形安定性を担保する。
//
// ## 粒度が2つある
//
//   branch（11種・**こちらが正典**） … 主砲を4経路 + 共通に割ったもの。傾向分析で使う（prd/06 §2.3）。
//   series（7種・branch からの導出） … 主砲を1つに畳んだもの。記述分析の積み上げ棒・
//                                       ドットマトリクスで使う（prd/06 §1.2）。
//
// **図の仕事が違えば粒度が違ってよい。** 記述分析は run の構成を俯瞰するのが仕事なので
// 主砲は1つで足り、11 色は知覚上の限界を超える。傾向分析は経路の優劣を見るのが仕事なので
// 展開が要る（パネルにラベルがあるため色で識別する必要がない）。→ prd/06 §2.4。

/** 主砲4経路 + 共通を展開した分類（傾向分析用・正典）。 */
export const UPGRADE_BRANCH_KEYS = [
  'railgun_common',
  'volley',
  'coil',
  'basilisk',
  'blunderbuss',
  'nuke',
  'shield',
  'flail',
  'automation',
  'opportunity',
  'unknown',
] as const
export type UpgradeBranch = (typeof UPGRADE_BRANCH_KEYS)[number]

/** 主砲を畳んだ分類（記述分析用・branch からの導出）。 */
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

export const UPGRADE_BRANCH_LABELS: Record<UpgradeBranch, string> = {
  railgun_common: '主砲共通（分岐前）',
  volley: '主砲: ヴォレー',
  coil: '主砲: コイルガン',
  basilisk: '主砲: バジリスク',
  blunderbuss: '主砲: ブランダーバス',
  nuke: '核兵器',
  shield: 'シールド',
  flail: 'フレイル',
  automation: '自動防衛（タワー/ドローン）',
  opportunity: 'OU（機会アップグレード）',
  unknown: '未分類',
}

export const UPGRADE_SERIES_LABELS: Record<UpgradeSeries, string> = {
  railgun: 'レールガン（主砲）',
  nuke: '核兵器',
  shield: 'シールド',
  flail: 'フレイル',
  automation: '自動防衛（タワー/ドローン）',
  opportunity: 'OU（機会アップグレード）',
  unknown: '未分類',
}

/** branch → series の畳み込み。主砲5種だけが railgun に寄る。 */
export const SERIES_OF_BRANCH: Record<UpgradeBranch, UpgradeSeries> = {
  railgun_common: 'railgun',
  volley: 'railgun',
  coil: 'railgun',
  basilisk: 'railgun',
  blunderbuss: 'railgun',
  nuke: 'nuke',
  shield: 'shield',
  flail: 'flail',
  automation: 'automation',
  opportunity: 'opportunity',
  unknown: 'unknown',
}

/**
 * 正規名 → branch。ガイド由来のため実際の出現名と揺れる可能性があり、
 * 未収載・不確かな名前は登録しない（unknown 扱いにして可視化する）。
 *
 * **これが分類の単一の真実**。series は SERIES_OF_BRANCH で導出する（二重管理しない）。
 */
export const UPGRADE_BRANCH_BY_NAME: Record<string, UpgradeBranch> = {
  // 主砲。OFFENSIVE INNOVATION CENTER の直後に4経路から1つを選び、選んだ経路は run 内で排他
  // （実データで検証済み）。経路選択はプレイヤー最大の意思決定なので、核・シールド等と
  // **同格の分類として横並びに扱う**（prd/06 §2.3）。
  //
  // 分岐前の共通強化は railgun_common に入れる。「その run が選んだ経路に含める」案は採らない
  // ——同じ名前が run によって違う分類になり、upgradeBranchOf(name) が純粋関数でなくなるため。
  // INCREASE FIRE RATE は分岐前・分岐後の双方で取得できる（文脈依存）が、名前だけからは
  // 判別できないので共通に置く。**経路ごとに専用ノードがあることは実測で裏が取れた**——
  // 同じ INCREASE FIRE RATE でも説明文が volley 版は『IMPROVE THE OVERALL EFFICIENCY OF
  // TURRET RELOAD MECHANISMS』（contracts-tree-03）、blunderbuss 版は『IMPROVE WASTE
  // PROCESSING AND BARREL RELOADING MECHANISMS』（contracts-tree-04）と変わる。
  // **名前が分かれるのは最終段だけ**（volley = EXTREME / blunderbuss = ULTIMATE FIRE RATE）で、
  // そこは経路ごとの branch に置いてある。
  'OFFENSIVE INNOVATION CENTER': 'railgun_common',
  'EXTENDED BARREL': 'railgun_common',
  'IMPROVE GIMBAL SPEED': 'railgun_common',
  'INCREASE FIRE RATE': 'railgun_common',
  'EFFICIENT RELOADING': 'railgun_common',
  // volley 枝。prd/samples/contracts-tree-03.png（ツリーを基本形から順にホバーした証拠シート）で
  // 連射数の派生が HEX まで揃った。基本形の説明文『FIRE TWIN ROUNDS …, POTENTIAL FOR LARGE
  // BARREL ARRAYS OR EXTREME RATES OF FIRE』のとおり、この枝は**連射数**と**発射レート**の
  // 2方向に伸びる。
  'VOLLEY RAILGUN': 'volley',
  'TRIPLE VOLLEY RAILGUN': 'volley',
  'QUAD VOLLEY RAILGUN': 'volley',
  'PENT VOLLEY RAILGUN': 'volley',
  'HEX VOLLEY RAILGUN': 'volley',
  // 発射レート方向の到達点（ユーザー確定 2026-07-31）。説明文『ENGINEER NOVEL TURRET RELOADING
  // MECHANISMS TO ACHIEVE UNPRECEDENTED RATES OF FIRE』だけを見ると INCREASE FIRE RATE /
  // EFFICIENT RELOADING の直系上位＝ railgun_common にも読めるが、基本形が『OR EXTREME RATES OF
  // FIRE』と名指ししている方を採った。**他経路の run でこの名前が出たら railgun_common へ移すこと**
  // （同じ名前が run によって違う分類になってはいけない。上の railgun_common の注記と同じ理由）。
  'EXTREME FIRE RATE': 'volley',
  // coil 枝。prd/samples/contracts-tree-02.png（ツリーを基本形から順にホバーした証拠シート）で
  // 7ノードが揃った。派生3種はいずれも説明文が COBALT / COBALT COIL の弾を指しており、
  // 前提条件ではなく**説明文**を根拠に coil としている。
  // FULL GRAPHENE COATING の前提は OU の OPERATION HERMIT だが、前提は系統を跨ぐので
  // 分類の根拠にしない（上の basilisk の注記と同じ）。
  'COBALT COIL GUN': 'coil',
  'INCREASE COIL RATE': 'coil',
  'RICOCHET MUNITIONS': 'coil',
  'ADVANCED RICOCHET': 'coil',
  'GRAPHENE TIPPED RODS': 'coil',
  'FULL GRAPHENE COATING': 'coil',
  'SUPERCONDUCTING MAG RAIL': 'coil',
  // basilisk 配下（BUNDLING / SPLINTER 系はここ。独立経路ではない）。
  // **前提条件は系統を跨ぐことがある**（ユーザー確認 2026-07-26）。例: INCENDIARY COATING は
  // basilisk 配下（説明が "DIP UTILITY POLE MUNITIONS…"）だが、前提は核系の OVER-FUELLED BOOSTERS。
  // 「A の前提が B だから A は B と同分類」という推論はしないこと。
  'TELEGRAPH BASILISK': 'basilisk',
  'INCREASE BUNDLING RATE': 'basilisk',
  'OVERWEIGHT BUNDLES': 'basilisk',
  'SPLINTERING POLES': 'basilisk',
  'HARDENED SPLINTERS': 'basilisk',
  'HURRIED BUNDLING': 'basilisk',
  'INCENDIARY COATING': 'basilisk',
  // blunderbuss 枝。prd/samples/contracts-tree-04.png で 7 ノードが揃った。
  // **基本形の時点で ×3 GUN BARRELS** なので、volley の TRIPLE 相当は枝に無い（3 → 4 → 5）。
  'GARBAGE BLUNDERBUSS': 'blunderbuss',
  'DELUXE TRASH COMPACTOR': 'blunderbuss',
  'QUAD BLUNDERBUSS': 'blunderbuss',
  'PENT BLUNDERBUSS': 'blunderbuss',
  'SAWN-OFF BARRELS': 'blunderbuss',
  // volley の EXTREME FIRE RATE に対応する最終段（説明文『PROCESS WASTE AND RELOAD BARRELS…』）。
  'ULTIMATE FIRE RATE': 'blunderbuss',
  // contracts-04 で初出したときは系統が読めず未分類にしていたが、blunderbuss ツリーで
  // GARBAGE BLUNDERBUSS / DELUXE TRASH COMPACTOR と同じ行に隣接して現れた（ユーザー確定
  // 2026-07-31）。説明文『IMPROVED CHAMBER DESIGN…INCREASING PROJECTILE VELOCITY AND DAMAGE』
  // 自体には経路特有の語彙が無いので、根拠はツリー上の位置である。
  'REFINED BLAST CHAMBERS': 'blunderbuss',
  // 核兵器系（NUCLEAR WEAPONS LAB 配下）
  'NUCLEAR WEAPONS LAB': 'nuke',
  'STOCKPILE NUKES': 'nuke',
  'INCREASE PRODUCTION': 'nuke',
  'URANIUM STRIP MINING': 'nuke',
  'RATIONED WARHEADS': 'nuke',
  'ANTIMATTER WARHEADS': 'nuke',
  'EXTENDED PLASMA DECAY': 'nuke',
  // ツリー上は中央のリロールノードから (2,2) の炎アイコン（ユーザー確認 2026-07-26）。
  // basilisk 系 INCENDIARY COATING の前提として現れるが、系統跨ぎの前提なので nuke のまま。
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
  'DOUBLE-BARRELLED DRONES': 'automation',
  // ユーザー確認済み（2026-07-05）: OPTIMIZED OPERATIONS = ドローン/レーザータワーの修復高速化。
  'OPTIMIZED OPERATIONS': 'automation',
  // OU（ガイド掲載の20種。UPGRADE HISTORY に載るものだけが記録に現れる）。
  // 傾向分析では系統に畳まず**個別に**扱う（prd/06 §2.3）。
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
}

/**
 * 正規名 → 系統（主砲を畳んだ粒度）。branch からの導出であり、独立に編集しない。
 * 既存の記述分析ビューと `seed ⊆ series` テストが参照する。
 */
export const UPGRADE_SERIES_BY_NAME: Record<string, UpgradeSeries> = Object.fromEntries(
  Object.entries(UPGRADE_BRANCH_BY_NAME).map(([name, branch]) => [name, SERIES_OF_BRANCH[branch]]),
)

/**
 * 分類を割り当てない正規名（**未分類**）。「特定系統に属さないと決めた名前」と
 * 「まだ分からない名前」の**両方**がここに入る。**未分類は一級市民**であり、
 * 分類が付くまでの待避所ではなく、そのまま `unknown` バケットとして分析に乗る（prd/06 §1.1）。
 *
 * カタログ seed の全名称は、分類済み（UPGRADE_BRANCH_BY_NAME）かここかのどちらかに載る必要がある
 * （database の __tests__/catalog-seed.test.ts が強制）。ゲーム更新で増えた新要素は、
 * **分類が分かるまでここに1行足せば seed に入れられる**（分類を調べ切るまで seed が止まらないように）。
 */
export const UPGRADE_SERIES_UNCLASSIFIED: ReadonlySet<string> = new Set([
  // 全分野に跨る高度技術の解放前提。特定系統に属さない（ユーザー確認済み）。
  'ADVANCED MATERIALS LAB',
  // ガイドの系統ツリーに無い。実測 run では出現するが所属不明。
  'SUPERCONDUCTING POWER LINES',
  'ROBOTICS SPECIALIST',
])

/** 正規名から branch を引く。未収載は 'unknown'。 */
export function upgradeBranchOf(name: string): UpgradeBranch {
  return UPGRADE_BRANCH_BY_NAME[name] ?? 'unknown'
}

/** 正規名から系統を引く（主砲を畳んだ粒度）。未収載は 'unknown'。 */
export function upgradeSeriesOf(name: string): UpgradeSeries {
  return SERIES_OF_BRANCH[upgradeBranchOf(name)]
}
