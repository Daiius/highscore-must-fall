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

/** 構文検証を通ったレコードに対する全ドメイン整合チェック。 */
export function runConsistencyChecks(record: RunRecord): ValidationIssue[] {
  return [...checkApocalypseBonus(record)]
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
