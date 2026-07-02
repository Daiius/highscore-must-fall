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

  it('INT 範囲を超えるコア指標は error（DB の INT 格納範囲に合わせる）', () => {
    const input = sampleRun()
    const bad = { ...input, result: { ...input.result, final_score: 2_147_483_648 } }
    expect(RunRecordSchema.safeParse(bad).success).toBe(false)
    const ok = { ...input, result: { ...input.result, final_score: 2_147_483_647 } }
    expect(RunRecordSchema.safeParse(ok).success).toBe(true)
  })

  it('191 文字を超える game は error（varchar(191) に合わせる）', () => {
    const bad = { ...sampleRun(), game: 'A'.repeat(192) }
    expect(RunRecordSchema.safeParse(bad).success).toBe(false)
  })

  it('正規化後 191 文字を超える upgrade 名は error', () => {
    const input = sampleRun()
    const bad = {
      ...input,
      upgrade_history: [
        { entry_type: 'upgrade', week_index: 1, order_in_week: 1, name: 'A'.repeat(192) },
      ],
    }
    expect(RunRecordSchema.safeParse(bad).success).toBe(false)
  })

  it('played_at は ISO(offset) を受理し、MySQL DATETIME 範囲外は error', () => {
    const input = sampleRun()
    expect(
      RunRecordSchema.safeParse({ ...input, played_at: '2026-07-03T02:00:00+09:00' }).success,
    ).toBe(true)
    // 西暦 1000 未満・9999 超は保存不可。
    expect(RunRecordSchema.safeParse({ ...input, played_at: '0999-12-31T23:59:59Z' }).success).toBe(
      false,
    )
    // offset 適用で UTC が 10000 年になるケースも弾く。
    expect(
      RunRecordSchema.safeParse({ ...input, played_at: '9999-12-31T23:59:59-05:00' }).success,
    ).toBe(false)
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
      name: String.fromCharCode(1, 2, 3), // min(1) は通るが normalize で空になる
    })
    expect(bad.success).toBe(false)
  })

  it('パース結果の name は正規形に確定する（contract で正規化を保証）', () => {
    const parsed = UpgradeHistoryEntrySchema.parse({
      entry_type: 'upgrade',
      week_index: 1,
      order_in_week: 1,
      name: '  chef’s   kiss ',
    })
    expect(parsed.entry_type === 'upgrade' && parsed.name).toBe("CHEF'S KISS")
  })

  it('reroll の flavor_text は verbatim（前後空白を保持・変換しない）', () => {
    const raw = '  welcoming ceremony  '
    const parsed = UpgradeHistoryEntrySchema.parse({
      entry_type: 'reroll',
      week_index: 2,
      order_in_week: 5,
      flavor_text: raw,
    })
    expect(parsed.entry_type === 'reroll' && parsed.flavor_text).toBe(raw)
  })

  it('flavor_text が MySQL TEXT 上限(65535 バイト)を超えると error', () => {
    const bad = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'reroll',
      week_index: 2,
      order_in_week: 1,
      flavor_text: 'x'.repeat(65_536),
    })
    expect(bad.success).toBe(false)
  })

  it('flavor_text が空白のみなら error', () => {
    const bad = UpgradeHistoryEntrySchema.safeParse({
      entry_type: 'reroll',
      week_index: 2,
      order_in_week: 5,
      flavor_text: '   ',
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
