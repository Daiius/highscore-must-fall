// 検証 & 整合チェック層。全投入ルート共通の品質ゲート。
// 入力 → Zod 構文検証（error）→ ドメイン整合チェック（warning/error）。
// error=確定不可 / warning=確定可・要確認 を区別する（prd/03 §4・prd/04 §4）。

import { DAYS_PER_WEEK, MAX_UPGRADES_PER_DAY } from './analysis'
import { type RunRecord, RunRecordSchema } from './schema'

export type IssueLevel = 'error' | 'warning'

export interface ValidationIssue {
  /** error=確定不可 / warning=確定可・要確認 */
  level: IssueLevel
  /** 機械可読なコード（UI 分岐・翻訳キー用） */
  code: string
  message: string
  /** レコード内の位置（例: ['result', 'apocalypse_bonus']） */
  path: (string | number)[]
}

export interface ValidationResult {
  /** error が 1 件も無ければ true（warning は許容） */
  ok: boolean
  issues: ValidationIssue[]
  /** 構文検証を通ったときのみ（default 適用済みの正規レコード） */
  record?: RunRecord
}

/**
 * apocalypse_bonus == Σ(reward_ledger.points)。
 * 観測されたゲーム内の自明な関係（prd/01 §5.1）。不一致は warning（人手修正）。
 */
export function checkApocalypseBonus(record: RunRecord): ValidationIssue[] {
  const sum = record.reward_ledger.reduce((acc, r) => acc + r.points, 0)
  if (sum === record.result.apocalypse_bonus) return []
  return [
    {
      level: 'warning',
      code: 'apocalypse_bonus_mismatch',
      message: `apocalypse_bonus(${record.result.apocalypse_bonus}) が reward_ledger の points 合計(${sum})と一致しません`,
      path: ['result', 'apocalypse_bonus'],
    },
  ]
}

/**
 * upgrade_history の (week_index, order_in_week) が週内で一意であること。
 * 重複すると「WEEK N の M 手目」が復元不能になるため error（確定不可）。
 * ※ 欠番までは要求しない（部分ドラフトでは欠番が正当。prd/04）。
 */
export function checkOrderInWeekUniqueness(record: RunRecord): ValidationIssue[] {
  const firstIndexByPosition = new Map<string, number>()
  const issues: ValidationIssue[] = []
  record.upgrade_history.forEach((entry, index) => {
    const key = `${entry.week_index}:${entry.order_in_week}`
    const firstIndex = firstIndexByPosition.get(key)
    if (firstIndex === undefined) {
      firstIndexByPosition.set(key, index)
      return
    }
    issues.push({
      level: 'error',
      code: 'duplicate_order_in_week',
      message: `WEEK ${entry.week_index} の週内位置 ${entry.order_in_week} が重複しています（entry #${firstIndex} と #${index}）`,
      path: ['upgrade_history', index, 'order_in_week'],
    })
  })
  return issues
}

/** (week_index, order_in_week) の辞書順比較。 */
function comparePosition(
  a: { week_index: number; order_in_week: number },
  b: { week_index: number; order_in_week: number },
): number {
  return a.week_index !== b.week_index
    ? a.week_index - b.week_index
    : a.order_in_week - b.order_in_week
}

/**
 * upgrade_history の配列順が (week_index, order_in_week) 昇順と一致すること。
 * 配列順と order_in_week は同じ「取得順」の二重表現であり、食い違うと
 * 「配列で読む」処理と「order_in_week で並べる」処理で結果が変わる（prd/01 §3・prd/03 §1）。
 * 逆順（配列順 > 位置順）を error にする。等値の重複は上の一意性チェックが担当。
 */
export function checkUpgradeHistoryOrder(record: RunRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  let previous: { week_index: number; order_in_week: number } | undefined
  record.upgrade_history.forEach((entry, index) => {
    if (previous && comparePosition(previous, entry) > 0) {
      issues.push({
        level: 'error',
        code: 'upgrade_history_out_of_order',
        message: `upgrade_history の配列順が (week_index, order_in_week) 昇順と一致しません（entry #${index - 1} → #${index}）`,
        path: ['upgrade_history', index],
      })
    }
    previous = { week_index: entry.week_index, order_in_week: entry.order_in_week }
  })
  return issues
}

/**
 * `max(week_index) <= ceil(days_survived / 7)`。
 *
 * 1週=7日（prd/01 §2）から導かれる自明な関係で、破れていればどちらかが誤読である。
 * 本番 18 run のうち 3 件がこれで検出され、`days_survived` 側の誤読だと判明した
 * （取得数と週構成は他の run と整合していた）。
 *
 * **warning に留める**理由: ゲーム側で週の長さが変わったときに、error だと投入が全部止まる。
 * 取り込みを止めない方針（prd/06 §1.1）を推論のための検証にも適用する。
 */
export function checkWeekAgainstDays(record: RunRecord): ValidationIssue[] {
  const maxWeek = record.upgrade_history.reduce((max, entry) => Math.max(max, entry.week_index), 0)
  if (maxWeek === 0) return []
  const weeksFromDays = Math.ceil(record.result.days_survived / DAYS_PER_WEEK)
  if (maxWeek <= weeksFromDays) return []
  return [
    {
      level: 'warning',
      code: 'week_exceeds_days_survived',
      message:
        `WEEK ${maxWeek} まで記録がありますが、days_survived(${record.result.days_survived}) から` +
        `到達しうるのは WEEK ${weeksFromDays} までです（1週=7日）。` +
        'どちらかが読み取りミスの可能性があります。',
      path: ['result', 'days_survived'],
    },
  ]
}

/**
 * 週内の upgrade 数 <= その週に生きた日数 × 2。
 *
 * 1日に取れる contract は基本1個・最大2個（prd/01 §2.1）。**観測から作った閾値ではなく
 * ゲームのルール**なので根拠にしてよい。これを超える履歴は物理的にありえず、
 * 週グループの取り違え（2列レイアウトの列またぎ誤配）や日数の誤読を示す。
 *
 * 仮取得日はこの制約を前提に週内を按分するので（prd/01 §2.1）、破れたまま確定させると
 * ありえない履歴が分析へ混入する。`days_survived` 側の誤読は `checkWeekAgainstDays` が
 * 拾えない範囲（週数は合うが日数が足りない場合）もここで検出できる。
 */
export function checkAcquisitionPace(record: RunRecord): ValidationIssue[] {
  const days = record.result.days_survived
  const upgradesByWeek = new Map<number, number>()
  for (const entry of record.upgrade_history) {
    if (entry.entry_type !== 'upgrade') continue
    upgradesByWeek.set(entry.week_index, (upgradesByWeek.get(entry.week_index) ?? 0) + 1)
  }

  const issues: ValidationIssue[] = []
  for (const [week, count] of [...upgradesByWeek].sort((a, b) => a[0] - b[0])) {
    const daysInWeek = Math.min(week * DAYS_PER_WEEK, days) - (week - 1) * DAYS_PER_WEEK
    // 週そのものが days から到達不能な場合は checkWeekAgainstDays の担当（二重に出さない）。
    if (daysInWeek <= 0) continue
    const max = daysInWeek * MAX_UPGRADES_PER_DAY
    if (count <= max) continue
    issues.push({
      level: 'warning',
      code: 'upgrades_exceed_daily_pace',
      message:
        `WEEK ${week} の取得数(${count})が、その週に生きた ${daysInWeek} 日で取りうる上限(${max})を` +
        '超えています（1日に取れるのは最大2個）。週グループか days_survived の読み取りミスの可能性があります。',
      path: ['upgrade_history'],
    })
  }
  return issues
}

/** 構文検証を通ったレコードに対する全ドメイン整合チェック。 */
export function runConsistencyChecks(record: RunRecord): ValidationIssue[] {
  return [
    ...checkApocalypseBonus(record),
    ...checkOrderInWeekUniqueness(record),
    ...checkUpgradeHistoryOrder(record),
    ...checkWeekAgainstDays(record),
    ...checkAcquisitionPace(record),
  ]
}

/**
 * 投入 1 件を検証する。構文（Zod）→ 整合チェックの順で issue を集約する。
 * 構文 error があれば record は返さない（確定不可）。
 */
export function validateRunRecord(input: unknown): ValidationResult {
  const parsed = RunRecordSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        level: 'error' as const,
        code: issue.code,
        message: issue.message,
        path: issue.path.map((p) => (typeof p === 'symbol' ? p.toString() : p)),
      })),
    }
  }

  const issues = runConsistencyChecks(parsed.data)
  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    record: parsed.data,
  }
}
