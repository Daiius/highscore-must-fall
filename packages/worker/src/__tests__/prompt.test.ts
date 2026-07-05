// プロンプトと契約（shared 抽出スキーマ → 正規レコード検証）の乖離検知（prd/04 §9.3）。
// EXAMPLE を実際の下流（フラット変換 → shared 検証）に通し、契約変更で fail させる。

import { extractionToFlatRecord, ScreenshotExtractionSchema, validateRunRecord } from 'shared'
import { describe, expect, it } from 'vitest'
import { buildExtractionPrompt, EXAMPLE_EXTRACTION } from '../prompt'

describe('buildExtractionPrompt', () => {
  it('画像の index とファイルパスを列挙する', () => {
    const prompt = buildExtractionPrompt(['/tmp/a.png', '/tmp/b.jpg'])
    expect(prompt).toContain('2 枚')
    expect(prompt).toContain('0: /tmp/a.png')
    expect(prompt).toContain('1: /tmp/b.jpg')
  })

  it('ドメインの落とし穴ルール（リロール・points・2列レイアウト・null）を含む', () => {
    const prompt = buildExtractionPrompt(['/tmp/a.png'])
    expect(prompt).toContain('reroll')
    expect(prompt).toContain('count（○×）とは掛けない')
    expect(prompt).toContain('2列レイアウト')
    expect(prompt).toContain('憶測せず null')
  })
})

describe('EXAMPLE_EXTRACTION（乖離検知）', () => {
  it('抽出スキーマに適合する', () => {
    expect(ScreenshotExtractionSchema.safeParse(EXAMPLE_EXTRACTION).success).toBe(true)
  })

  it('フラット変換後、正規レコードとして error/warning なしで検証を通る（自己整合）', () => {
    const extraction = ScreenshotExtractionSchema.parse(EXAMPLE_EXTRACTION)
    const flat = extractionToFlatRecord(extraction)
    // order_in_week の採番は server の ingestion アダプタの仕事。ここでは同じ規約
    // （週ごとの連番）を適用して下流検証まで通す。
    const counters = new Map<number, number>()
    const history = (flat.upgrade_history as Record<string, unknown>[]).map((e) => {
      const week = e.week as number
      const next = (counters.get(week) ?? 0) + 1
      counters.set(week, next)
      const { week: _, type, ...rest } = e
      return { ...rest, week_index: week, order_in_week: next, entry_type: type }
    })
    const result = validateRunRecord({ ...flat, upgrade_history: history })
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([]) // Σpoints = apocalypse_bonus で warning も無い
  })
})
