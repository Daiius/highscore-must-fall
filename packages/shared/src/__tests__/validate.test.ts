import { describe, expect, it } from 'vitest'
import { validateRunRecord } from '../validate'
import { sampleRun } from './sample-run'

describe('validateRunRecord', () => {
  it('整合の取れたサンプルは ok・warning なし・record あり', () => {
    const result = validateRunRecord(sampleRun())
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
    expect(result.record).toBeDefined()
  })

  it('返す正規レコードは upgrade / reward 名が正規形に確定している', () => {
    const input = sampleRun()
    const messy = {
      ...input,
      upgrade_history: [
        { entry_type: 'upgrade' as const, week_index: 1, order_in_week: 1, name: ' arc  flail ' },
      ],
      reward_ledger: [{ name: 'chef’s  kiss', count: 7, points: 1208 }],
    }
    const result = validateRunRecord(messy)
    expect(result.ok).toBe(true)
    const [entry] = result.record?.upgrade_history ?? []
    expect(entry?.entry_type === 'upgrade' && entry.name).toBe('ARC FLAIL')
    expect(result.record?.reward_ledger[0]?.name).toBe("CHEF'S KISS")
  })

  it('apocalypse_bonus と reward 合計の不一致は warning（確定は可能）', () => {
    const input = sampleRun()
    const mismatch = { ...input, result: { ...input.result, apocalypse_bonus: 9999 } }
    const result = validateRunRecord(mismatch)

    expect(result.ok).toBe(true) // warning は確定可
    expect(result.record).toBeDefined()
    expect(result.issues).toHaveLength(1)
    const [issue] = result.issues
    expect(issue?.level).toBe('warning')
    expect(issue?.code).toBe('apocalypse_bonus_mismatch')
    expect(issue?.path).toEqual(['result', 'apocalypse_bonus'])
  })

  it('週内位置の重複は error（確定不可・該当 entry を path で指す）', () => {
    const input = sampleRun()
    const dup = {
      ...input,
      upgrade_history: [
        { entry_type: 'upgrade' as const, week_index: 1, order_in_week: 1, name: 'ARC FLAIL' },
        {
          entry_type: 'upgrade' as const,
          week_index: 1,
          order_in_week: 1,
          name: 'PLASMA PHYSICS LAB',
        },
      ],
    }
    const result = validateRunRecord(dup)

    expect(result.ok).toBe(false)
    expect(result.record).toBeDefined() // 構造は正しいのでレビュー表示は可能
    const issue = result.issues.find((i) => i.code === 'duplicate_order_in_week')
    expect(issue?.level).toBe('error')
    expect(issue?.path).toEqual(['upgrade_history', 1, 'order_in_week'])
  })

  it('別週なら同じ order_in_week でも通る', () => {
    const input = sampleRun()
    const ok = {
      ...input,
      upgrade_history: [
        { entry_type: 'upgrade' as const, week_index: 1, order_in_week: 1, name: 'ARC FLAIL' },
        { entry_type: 'upgrade' as const, week_index: 2, order_in_week: 1, name: 'EXTENDED FLAIL' },
      ],
    }
    const result = validateRunRecord(ok)
    expect(result.issues.some((i) => i.code === 'duplicate_order_in_week')).toBe(false)
  })

  it('配列順が (week_index, order_in_week) 昇順と食い違うと error', () => {
    const input = sampleRun()
    const outOfOrder = {
      ...input,
      upgrade_history: [
        {
          entry_type: 'upgrade' as const,
          week_index: 1,
          order_in_week: 2,
          name: 'PLASMA PHYSICS LAB',
        },
        { entry_type: 'upgrade' as const, week_index: 1, order_in_week: 1, name: 'ARC FLAIL' },
      ],
    }
    const result = validateRunRecord(outOfOrder)

    expect(result.ok).toBe(false)
    const issue = result.issues.find((i) => i.code === 'upgrade_history_out_of_order')
    expect(issue?.level).toBe('error')
    expect(issue?.path).toEqual(['upgrade_history', 1])
  })

  it('欠番（1,3 のように飛ぶ）は許容する（部分ドラフト）', () => {
    const input = sampleRun()
    const gapped = {
      ...input,
      upgrade_history: [
        { entry_type: 'upgrade' as const, week_index: 1, order_in_week: 1, name: 'ARC FLAIL' },
        {
          entry_type: 'upgrade' as const,
          week_index: 1,
          order_in_week: 3,
          name: 'PLASMA PHYSICS LAB',
        },
      ],
    }
    const result = validateRunRecord(gapped)
    expect(result.issues.some((i) => i.code === 'upgrade_history_out_of_order')).toBe(false)
    expect(result.ok).toBe(true)
  })

  it('構文 error では ok=false・record を返さない', () => {
    const input = sampleRun()
    const broken = { ...input, result: { ...input.result, final_score: -1 } }
    const result = validateRunRecord(broken)

    expect(result.ok).toBe(false)
    expect(result.record).toBeUndefined()
    expect(result.issues.every((i) => i.level === 'error')).toBe(true)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('未知入力（非オブジェクト）でも例外を投げず error にする', () => {
    const result = validateRunRecord(null)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})

describe('週と日数の整合（prd/01 §2.1）', () => {
  /** WEEK w に n 個の upgrade を置く履歴を作る。 */
  const history = (weeks: Record<number, number>) =>
    Object.entries(weeks).flatMap(([week, n]) =>
      Array.from({ length: n }, (_, i) => ({
        entry_type: 'upgrade' as const,
        week_index: Number(week),
        order_in_week: i + 1,
        name: 'ARC FLAIL',
      })),
    )

  it('days から到達できない週まで記録があると warning（確定は可能）', () => {
    const input = sampleRun()
    const result = validateRunRecord({
      ...input,
      result: { ...input.result, days_survived: 10 },
      upgrade_history: history({ 1: 12, 2: 10, 3: 5 }), // ceil(10/7)=2 なのに W3 がある
    })
    expect(result.ok).toBe(true)
    const issue = result.issues.find((i) => i.code === 'week_exceeds_days_survived')
    expect(issue?.level).toBe('warning')
    expect(issue?.path).toEqual(['result', 'days_survived'])
  })

  it('週数と days が整合していれば warning を出さない', () => {
    const input = sampleRun()
    const result = validateRunRecord({
      ...input,
      result: { ...input.result, days_survived: 18 },
      upgrade_history: history({ 1: 12, 2: 10, 3: 5 }),
    })
    expect(result.issues.some((i) => i.code === 'week_exceeds_days_survived')).toBe(false)
  })

  it('1日2個の上限を超える週は warning', () => {
    const input = sampleRun()
    const result = validateRunRecord({
      ...input,
      result: { ...input.result, days_survived: 5 },
      upgrade_history: history({ 1: 11 }), // 5 日で 11 個は不可能（上限 10）
    })
    expect(result.ok).toBe(true)
    const issue = result.issues.find((i) => i.code === 'upgrades_exceed_daily_pace')
    expect(issue?.level).toBe('warning')
  })

  it('上限ちょうど（1日2個）は通す', () => {
    const input = sampleRun()
    const result = validateRunRecord({
      ...input,
      result: { ...input.result, days_survived: 7 },
      upgrade_history: history({ 1: 14 }),
    })
    expect(result.issues.some((i) => i.code === 'upgrades_exceed_daily_pace')).toBe(false)
  })

  it('週が到達不能な場合、ペース違反を二重に出さない', () => {
    const input = sampleRun()
    const result = validateRunRecord({
      ...input,
      result: { ...input.result, days_survived: 5 },
      upgrade_history: history({ 1: 9, 3: 4 }), // W3 は days から到達不能
    })
    expect(result.issues.filter((i) => i.code === 'upgrades_exceed_daily_pace')).toHaveLength(0)
    expect(result.issues.some((i) => i.code === 'week_exceeds_days_survived')).toBe(true)
  })
})
