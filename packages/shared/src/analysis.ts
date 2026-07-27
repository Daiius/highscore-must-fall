// 傾向分析の純粋計算（prd/06 §2）。
//
// ここに置く理由は、仮取得日の式がゲームのドメイン事実（1週=7日・リロールは contract 枠を
// 消費しない。prd/01 §2.1・§3.1）からの導出だから。DB にも UI にも依存しない純粋関数にして、
// server が SQL で取った行を渡して集計させる（prd/06 §2 の実装方針）。
//
// ## 読むときの注意: ここが返すのは記述であって、因果の根拠ではない
//
// **取得数も初出日も、run 開始時に確定する曝露ではない**（time-dependent exposure。prd/06 §2.1）。
//
//   - 取得数 … 1日1〜2個ずつ増えるので、長く生きた run ほど事後的に多くなる。
//   - 初出日 … 「20 日目に初出」であるためには 20 日目まで生きている必要がある。
//              つまり初出が遅いほど、生存もスコアも高く見える（immortal-time bias）。
//
// どちらも「取ると伸びる」「早く取ると伸びる」の根拠にならない。方向性を論じるには
// **ランドマーク分析**（固定時点 T までの取得有無で分け、T まで生存した run に限って
// その後を比較する）が要る。それは第2段階（prd/06 §2.6）であり、ここでは計算しない。

import { UPGRADE_BRANCH_KEYS, type UpgradeBranch, upgradeBranchOf } from './series'

/** 1週間の日数（prd/01 §2）。 */
export const DAYS_PER_WEEK = 7

/**
 * 1日に取得できる contract の上限（prd/01 §2.1）。基本は1個で、得点が高い日に1個追加される。
 * **観測から作った閾値ではなくゲームのルール**なので、整合チェックの根拠に使ってよい。
 */
export const MAX_UPGRADES_PER_DAY = 2

/**
 * 「データ不足」バッジを出す閾値（prd/06 §2.5）。
 * **表示専用**であり、集計から除外するために使ってはならない
 * （`verified` バッジと同じ扱い。prd/08 §9.1）。
 */
export const LOW_SAMPLE_THRESHOLD = 5

export type AnalysisEntryType = 'upgrade' | 'reroll'
export type UpgradeKind = 'contract' | 'opportunity_upgrade'

/** upgrade_entry 1 行ぶんの分析入力。 */
export interface AnalysisEntry {
  weekIndex: number
  orderInWeek: number
  entryType: AnalysisEntryType
  /** upgrade のみ。カタログ未紐付けなら null。 */
  name: string | null
  /** upgrade のみ。DB の `upgrade_catalog.kind`（正典は seed）。 */
  kind?: UpgradeKind | null
}

/** run 1 件ぶんの分析入力。 */
export interface AnalysisRunInput {
  runId: string
  finalScore: number
  daysSurvived: number
  nukesLaunched: number
  entries: AnalysisEntry[]
}

/** 仮取得日を付けたエントリ。 */
export interface DatedEntry extends AnalysisEntry {
  /** 推定した取得日（小数。1週=7日を週内の取得順で按分）。 */
  day: number
}

export interface BranchPoint {
  runId: string
  finalScore: number
  daysSurvived: number
  /** その run でその分類を取った数。 */
  count: number
  /** 初出の仮取得日。一度も取っていなければ null。 */
  firstDay: number | null
}

export interface BranchTrend {
  branch: UpgradeBranch
  /** 全 run ぶんの点。取っていない run も count=0 / firstDay=null で含める（比較対象を消さない）。 */
  points: BranchPoint[]
  /** 1 個以上取った run の数（n バッジ用）。 */
  takenRuns: number
  /** takenRuns < LOW_SAMPLE_THRESHOLD。表示専用。 */
  lowSample: boolean
}

export interface OpportunityPoint {
  runId: string
  finalScore: number
  daysSurvived: number
  /** 取得の仮取得日。取っていなければ null（UI では「未取得」列に置く）。 */
  day: number | null
}

export interface OpportunityTrend {
  name: string
  points: OpportunityPoint[]
  takenRuns: number
  lowSample: boolean
}

export interface RunMetricPoint {
  runId: string
  finalScore: number
  daysSurvived: number
  /** リロール回数 ÷ 取得機会（upgrade 数）。回数そのものは生存に比例するため率で見る。 */
  rerollRate: number
  /** 核発射数 ÷ 生存日数。 */
  nukesPerDay: number
  /** upgrade の総取得数（時間依存曝露なので、原因側には置かない）。 */
  upgrades: number
}

export interface TrendAnalysis {
  runCount: number
  branches: BranchTrend[]
  opportunities: OpportunityTrend[]
  runMetrics: RunMetricPoint[]
  lowSampleThreshold: number
}

/**
 * 仮取得日を推定する（prd/01 §2.1）。
 *
 *   仮取得日 = (w-1)*7 + L_w * (j - 0.5) / m_w
 *
 * **返すのは「経過日数」であって、ゲーム内の『N 日目』ではない。** 値域は `(0, days_survived]` で、
 * WEEK 1 の先頭は 0 に近い小数になる（1 日目は経過 0〜1 に対応する）。
 * ゲーム内の日番号が要るときは `gameDayOf()` を使う。UI で「0.3 日目」と出すと、
 * ゲームに存在しない日を実測値のように見せてしまう。
 *
 * **これは観測値ではなく推定値である。** 一次情報（結果画面）から確実に取れるのは
 * 「どの週か」と「週内で何番目か」までで（prd/01 §2）、週内が等間隔だったという仮定を置いている。
 * 取得ペースが 1.40〜1.80 個/日で安定していること（実測 18 run）が仮定の根拠だが、
 * 個々の run で間隔が偏っていれば当然ずれる。UI では推定であることを明示する。
 *
 * `L_w` はその週に生き延びた日数、`m_w` は週内の upgrade 数、`j` は週内で何番目の upgrade か。
 * **リロールは数えない** — contract 枠を消費せず時間を進めないため（prd/01 §3.1）。
 *
 * @param weekIndex 1 始まり
 * @param upgradeRankInWeek 週内で何番目の upgrade か（1 始まり）
 * @param upgradesInWeek その週の upgrade 数
 * @param daysSurvived run の生存日数
 */
export function estimateAcquisitionDay(
  weekIndex: number,
  upgradeRankInWeek: number,
  upgradesInWeek: number,
  daysSurvived: number,
): number {
  const weekStart = (weekIndex - 1) * DAYS_PER_WEEK
  // 週の途中で死んだ run はその週の日数が 7 未満になる。
  // データが不整合（week が days から見て進みすぎ）でも落とさないよう 1 日で下限を切る
  // ——検出は validate 側の責務（prd/01 §2.1 の整合ルール）。
  const daysInWeek = Math.max(1, Math.min(weekIndex * DAYS_PER_WEEK, daysSurvived) - weekStart)
  if (upgradesInWeek <= 0) return weekStart + daysInWeek
  return weekStart + (daysInWeek * (upgradeRankInWeek - 0.5)) / upgradesInWeek
}

/**
 * 経過日数（`estimateAcquisitionDay` の戻り値）を**ゲーム内の日番号**に直す。
 * 1 日目は経過 0〜1 に対応するので切り上げる。経過 0 ちょうどでも 1 日目になるよう下限を切る。
 */
export function gameDayOf(elapsedDays: number): number {
  return Math.max(1, Math.ceil(elapsedDays))
}

/**
 * run のエントリに仮取得日を付ける。
 * リロールは**直後の upgrade と同じ日**にする（同じ機会の中での引き直しなので）。
 * 後続の upgrade が無いリロールは、その週の終端に置く。
 */
export function withAcquisitionDays(run: AnalysisRunInput): DatedEntry[] {
  const byWeek = new Map<number, AnalysisEntry[]>()
  for (const entry of run.entries) {
    const list = byWeek.get(entry.weekIndex)
    if (list) list.push(entry)
    else byWeek.set(entry.weekIndex, [entry])
  }

  const dated: DatedEntry[] = []
  for (const [weekIndex, entries] of byWeek) {
    const ordered = [...entries].sort((a, b) => a.orderInWeek - b.orderInWeek)
    const upgradesInWeek = ordered.filter((e) => e.entryType === 'upgrade').length

    // 先に upgrade へ日を振る。
    const days = new Array<number>(ordered.length)
    let rank = 0
    for (const [i, entry] of ordered.entries()) {
      if (entry.entryType !== 'upgrade') continue
      rank += 1
      days[i] = estimateAcquisitionDay(weekIndex, rank, upgradesInWeek, run.daysSurvived)
    }
    // リロールは後ろから見て「直後の upgrade」の日を借りる。
    const weekEnd =
      (weekIndex - 1) * DAYS_PER_WEEK +
      Math.max(
        1,
        Math.min(weekIndex * DAYS_PER_WEEK, run.daysSurvived) - (weekIndex - 1) * DAYS_PER_WEEK,
      )
    let nextUpgradeDay = weekEnd
    for (let i = ordered.length - 1; i >= 0; i--) {
      const entry = ordered[i]
      if (!entry) continue
      if (entry.entryType === 'upgrade') nextUpgradeDay = days[i] ?? weekEnd
      else days[i] = nextUpgradeDay
    }

    for (const [i, entry] of ordered.entries()) {
      dated.push({ ...entry, day: days[i] ?? weekEnd })
    }
  }
  return dated.sort(
    (a, b) => a.day - b.day || a.weekIndex - b.weekIndex || a.orderInWeek - b.orderInWeek,
  )
}

/**
 * OU かどうか。**`kind` と名前分類のどちらかが OU と言えば OU** とする（precedence ではなく和）。
 *
 * 2 つの出所が食い違うのは、どちらも「未追随」の形でしか起きないため:
 *   - `kind=opportunity_upgrade` だが `series.ts` に無い … ゲーム更新直後の新 OU
 *     （自動登録された行に seed で kind が付いた状態）
 *   - `series.ts` では OU だが `kind=contract` … **その行がまだ再 seed されていない**
 *     （unverified 自動登録の既定は `contract`。rules/database.md）
 *
 * どちらの食い違いも「実際は OU」を意味するので、和を取るのが正しい。
 */
function isOpportunity(entry: AnalysisEntry): boolean {
  if (entry.kind === 'opportunity_upgrade') return true
  return entry.name !== null && upgradeBranchOf(entry.name) === 'opportunity'
}

/**
 * エントリの分類。**OU 判定と同じ規則で決める**——`kind` が OU なら名前分類に関わらず
 * `opportunity` にする。
 *
 * ここを名前分類だけで決めると、**カタログ上は OU だが `series.ts` に未収載の名前**が
 * 個別 OU パネルと `unknown` の両方に計上され、branch の取得数・初出日・takenRuns が汚れる。
 * ゲーム更新直後（新 OU が unverified 自動登録される期間）に必ず起きる。
 */
function branchOfEntry(entry: AnalysisEntry): UpgradeBranch {
  if (isOpportunity(entry)) return 'opportunity'
  return entry.name === null ? 'unknown' : upgradeBranchOf(entry.name)
}

/**
 * 傾向分析の集計。**渡された run はすべて集計に乗る**（n が少なくても除外しない。prd/06 §2.5）。
 * owner の絞り込みは呼び出し側（server）の責務。
 */
export function buildTrendAnalysis(runs: readonly AnalysisRunInput[]): TrendAnalysis {
  const perRun = runs.map((run) => ({ run, dated: withAcquisitionDays(run) }))

  const branches: BranchTrend[] = UPGRADE_BRANCH_KEYS.map((branch) => {
    const points: BranchPoint[] = perRun.map(({ run, dated }) => {
      const hits = dated.filter(
        (e) => e.entryType === 'upgrade' && e.name !== null && branchOfEntry(e) === branch,
      )
      return {
        runId: run.runId,
        finalScore: run.finalScore,
        daysSurvived: run.daysSurvived,
        count: hits.length,
        firstDay: hits.length > 0 ? Math.min(...hits.map((e) => e.day)) : null,
      }
    })
    const takenRuns = points.filter((p) => p.count > 0).length
    return { branch, points, takenRuns, lowSample: takenRuns < LOW_SAMPLE_THRESHOLD }
  })

  // OU は系統に畳まず個別に扱う（prd/06 §2.3）。観測された名前だけを行にする。
  const ouNames = new Set<string>()
  for (const { dated } of perRun) {
    for (const entry of dated) {
      if (entry.entryType === 'upgrade' && entry.name && isOpportunity(entry))
        ouNames.add(entry.name)
    }
  }
  const opportunities: OpportunityTrend[] = [...ouNames]
    .sort()
    .map((name) => {
      const points: OpportunityPoint[] = perRun.map(({ run, dated }) => {
        const hits = dated.filter((e) => e.entryType === 'upgrade' && e.name === name)
        return {
          runId: run.runId,
          finalScore: run.finalScore,
          daysSurvived: run.daysSurvived,
          day: hits.length > 0 ? Math.min(...hits.map((e) => e.day)) : null,
        }
      })
      const takenRuns = points.filter((p) => p.day !== null).length
      return { name, points, takenRuns, lowSample: takenRuns < LOW_SAMPLE_THRESHOLD }
    })
    .sort((a, b) => b.takenRuns - a.takenRuns || a.name.localeCompare(b.name))

  const runMetrics: RunMetricPoint[] = perRun.map(({ run, dated }) => {
    const upgrades = dated.filter((e) => e.entryType === 'upgrade').length
    const rerolls = dated.filter((e) => e.entryType === 'reroll').length
    return {
      runId: run.runId,
      finalScore: run.finalScore,
      daysSurvived: run.daysSurvived,
      rerollRate: upgrades > 0 ? rerolls / upgrades : 0,
      nukesPerDay: run.daysSurvived > 0 ? run.nukesLaunched / run.daysSurvived : 0,
      upgrades,
    }
  })

  return {
    runCount: runs.length,
    branches,
    opportunities,
    runMetrics,
    lowSampleThreshold: LOW_SAMPLE_THRESHOLD,
  }
}
