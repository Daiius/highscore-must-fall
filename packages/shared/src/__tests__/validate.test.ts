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
