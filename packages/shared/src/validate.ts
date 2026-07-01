// 検証 & 整合チェック層。全投入ルート共通の品質ゲート。
// 入力 → Zod 構文検証（error）→ ドメイン整合チェック（warning/error）。
// error=確定不可 / warning=確定可・要確認 を区別する（prd/03 §4・prd/04 §4）。

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

/** 構文検証を通ったレコードに対する全ドメイン整合チェック。 */
export function runConsistencyChecks(record: RunRecord): ValidationIssue[] {
  return [
    ...checkApocalypseBonus(record),
    ...checkOrderInWeekUniqueness(record),
    ...checkUpgradeHistoryOrder(record),
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
