import { describe, expect, it } from 'vitest'
import { ingestSubmission, parseSubmission, toCanonicalRunRecord } from '../ingest'

describe('parseSubmission', () => {
  it('JSON をパースする', () => {
    const r = parseSubmission('{"a":1}', 'json')
    expect(r).toEqual({ ok: true, value: { a: 1 }, format: 'json' })
  })

  it('YAML をパースする', () => {
    const r = parseSubmission('a: 1\nb: two', 'yaml')
    expect(r.ok && r.value).toEqual({ a: 1, b: 'two' })
  })

  it('auto は JSON を優先し、ダメなら YAML にフォールバックする', () => {
    const j = parseSubmission('{"a":1}')
    expect(j.ok && j.format).toBe('json')
    const y = parseSubmission('a: 1')
    expect(y.ok && y.format).toBe('yaml')
  })

  it('空入力は失敗', () => {
    expect(parseSubmission('   ').ok).toBe(false)
  })

  it('壊れた入力は失敗し理由を返す', () => {
    const r = parseSubmission('{ not valid', 'json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('JSON')
  })
})

describe('toCanonicalRunRecord', () => {
  it('フラット形の upgrade_history に週内連番 order_in_week を振る', () => {
    const flat = {
      upgrade_history: [
        { week: 1, type: 'upgrade', name: 'A' },
        { week: 1, type: 'upgrade', name: 'B' },
        { week: 2, type: 'reroll', flavor: 'FOO' },
        { week: 2, type: 'upgrade', name: 'C' },
      ],
    }
    const canonical = toCanonicalRunRecord(flat) as {
      upgrade_history: Record<string, unknown>[]
    }
    expect(canonical.upgrade_history).toEqual([
      { week_index: 1, order_in_week: 1, entry_type: 'upgrade', name: 'A' },
      { week_index: 1, order_in_week: 2, entry_type: 'upgrade', name: 'B' },
      { week_index: 2, order_in_week: 1, entry_type: 'reroll', flavor_text: 'FOO' },
      { week_index: 2, order_in_week: 2, entry_type: 'upgrade', name: 'C' },
    ])
  })

  it('正規形が来ても壊さない（冪等）', () => {
    const canonicalIn = {
      upgrade_history: [{ week_index: 3, order_in_week: 5, entry_type: 'upgrade', name: 'X' }],
    }
    const out = toCanonicalRunRecord(canonicalIn) as { upgrade_history: Record<string, unknown>[] }
    expect(out.upgrade_history[0]).toMatchObject({
      week_index: 3,
      order_in_week: 5,
      entry_type: 'upgrade',
      name: 'X',
    })
  })

  it('reroll に flavor が無ければ flavor_text を付けない', () => {
    const out = toCanonicalRunRecord({
      upgrade_history: [{ week: 1, type: 'reroll' }],
    }) as { upgrade_history: Record<string, unknown>[] }
    expect(out.upgrade_history[0]).toEqual({
      week_index: 1,
      order_in_week: 1,
      entry_type: 'reroll',
    })
  })

  it('upgrade_history が配列でなければ素通し', () => {
    expect(toCanonicalRunRecord({ upgrade_history: 'nope' })).toEqual({ upgrade_history: 'nope' })
  })
})

describe('ingestSubmission', () => {
  const validFlat = {
    result: {
      days_survived: 10,
      final_score: 100,
      aliens_defeated: 5,
      nukes_launched: 1,
      apocalypse_bonus: 30,
    },
    upgrade_history: [
      { week: 1, type: 'upgrade', name: 'NUCLEAR WEAPONS LAB' },
      { week: 1, type: 'reroll', flavor: 'DIGITIZE CONSCIOUSNESS' },
    ],
    reward_ledger: [
      { name: 'BOHEMIAN', count: 1, points: 20 },
      { name: 'OBSESSIVE', count: 2, points: 10 },
    ],
  }

  it('整合したフラット JSON は ok=true・warning 無し', () => {
    const r = ingestSubmission(JSON.stringify(validFlat), 'json')
    expect(r.ok).toBe(true)
    expect(r.format).toBe('json')
    expect(r.issues).toEqual([])
    expect(r.record?.upgrade_history[0]).toMatchObject({ order_in_week: 1, entry_type: 'upgrade' })
  })

  it('apocalypse_bonus 不一致は ok=true だが warning', () => {
    const bad = { ...validFlat, result: { ...validFlat.result, apocalypse_bonus: 999 } }
    const r = ingestSubmission(JSON.stringify(bad), 'json')
    expect(r.ok).toBe(true)
    expect(
      r.issues.some((i) => i.level === 'warning' && i.code === 'apocalypse_bonus_mismatch'),
    ).toBe(true)
  })

  it('パース不能は error 1 件の検証結果に載る', () => {
    const r = ingestSubmission('{ broken', 'json')
    expect(r.ok).toBe(false)
    expect(r.format).toBe(null)
    expect(r.issues[0]?.code).toBe('parse_error')
  })

  it('型不正（負のスコア）は error', () => {
    const bad = { ...validFlat, result: { ...validFlat.result, final_score: -1 } }
    const r = ingestSubmission(JSON.stringify(bad), 'json')
    expect(r.ok).toBe(false)
  })
})
