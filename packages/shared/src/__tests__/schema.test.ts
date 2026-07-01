import { describe, expect, it } from 'vitest'
import { RunRecordSchema, UpgradeHistoryEntrySchema } from '../schema'
import { SCHEMA_VERSION } from '../version'
import { sampleRun } from './sample-run'

describe('RunRecordSchema', () => {
  it('サンプル run をパースできる', () => {
    const parsed = RunRecordSchema.safeParse(sampleRun())
    expect(parsed.success).toBe(true)
  })

  it('schema_version / game は省略時に既定値が入る', () => {
    const { schema_version: _sv, game: _g, ...rest } = sampleRun()
    const parsed = RunRecordSchema.parse(rest)
    expect(parsed.schema_version).toBe(SCHEMA_VERSION)
    expect(parsed.game).toBe('UTOPIA MUST FALL')
  })

  it('result の未知指標を温存する（loose）', () => {
    const input = sampleRun()
    const withExtra = { ...input, result: { ...input.result, cities_saved: 42 } }
    const parsed = RunRecordSchema.parse(withExtra)
    expect((parsed.result as Record<string, unknown>).cities_saved).toBe(42)
  })

  it('負値のコア指標は error になる', () => {
    const input = sampleRun()
    const bad = { ...input, result: { ...input.result, final_score: -1 } }
    expect(RunRecordSchema.safeParse(bad).success).toBe(false)
  })

  it('小数のコア指標は error になる', () => {
    const input = sampleRun()
    const bad = { ...input, result: { ...input.result, days_survived: 1.5 } }
    expect(RunRecordSchema.safeParse(bad).success).toBe(false)
  })

  it('現行と異なる schema_version は error（別版は migrateToCurrent 経由）', () => {
    const bad = { ...sampleRun(), schema_version: '9.9.9' }
    expect(RunRecordSchema.safeParse(bad).success).toBe(false)
  })

  it('現行 schema_version の明示指定は通る', () => {
    const ok = { ...sampleRun(), schema_version: SCHEMA_VERSION }
    expect(RunRecordSchema.safeParse(ok).success).toBe(true)
  })
})

describe('UpgradeHistoryEntrySchema', () => {
  it('upgrade は name 必須', () => {
    const ok = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'upgrade',
      week_index: 1,
      order_in_week: 1,
      name: 'ARC FLAIL',
    })
    expect(ok.success).toBe(true)

    const missingName = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'upgrade',
      week_index: 1,
      order_in_week: 1,
    })
    expect(missingName.success).toBe(false)
  })

  it('正規化後に空になる name（制御文字のみ等）は error', () => {
    const bad = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'upgrade',
      week_index: 1,
      order_in_week: 1,
      name: String.fromCharCode(1, 2, 3), // trim/min(1) は通るが normalize で空になる
    })
    expect(bad.success).toBe(false)
  })

  it('reroll は name 無しで通り、flavor_text は任意', () => {
    const ok = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'reroll',
      week_index: 2,
      order_in_week: 2,
      flavor_text: 'DIGITIZE CONSCIOUSNESS',
    })
    expect(ok.success).toBe(true)

    const noFlavor = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'reroll',
      week_index: 2,
      order_in_week: 5,
    })
    expect(noFlavor.success).toBe(true)
  })

  it('未知の entry_type は error（第3種は存在しない）', () => {
    const bad = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'opportunity',
      week_index: 1,
      order_in_week: 1,
      name: 'CONTEXT SWITCH',
    })
    expect(bad.success).toBe(false)
  })

  it('week_index / order_in_week は 1 以上', () => {
    const bad = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'upgrade',
      week_index: 0,
      order_in_week: 1,
      name: 'ARC FLAIL',
    })
    expect(bad.success).toBe(false)
  })
})
