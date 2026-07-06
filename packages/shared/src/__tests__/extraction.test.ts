import { describe, expect, it } from 'vitest'
import {
  extractionToFlatRecord,
  SCREENSHOT_EXTRACTION_JSON_SCHEMA_ID,
  type ScreenshotExtraction,
  ScreenshotExtractionSchema,
  screenshotExtractionJsonSchema,
} from '../extraction'
import { SCHEMA_VERSION } from '../version'

/** 3 section 揃いの完全な抽出結果（sample-01 相当の縮約）。 */
const fullExtraction: ScreenshotExtraction = {
  images: [
    { index: 0, section: 'result' },
    { index: 1, section: 'upgrade_history' },
    { index: 2, section: 'reward_ledger' },
  ],
  result: {
    days_survived: 10,
    final_score: 143161,
    aliens_defeated: 1336,
    nukes_launched: 3,
    apocalypse_bonus: 1208,
  },
  upgrade_history: [
    { week: 1, type: 'upgrade', name: 'NUCLEAR WEAPONS LAB', flavor: null },
    { week: 2, type: 'reroll', name: null, flavor: 'DIGITIZE CONSCIOUSNESS' },
  ],
  reward_ledger: [{ name: 'BOHEMIAN', count: 1, points: 1208 }],
}

describe('ScreenshotExtractionSchema', () => {
  it('完全な抽出結果を受理する', () => {
    expect(ScreenshotExtractionSchema.safeParse(fullExtraction).success).toBe(true)
  })

  it('読めない値の null（result 指標・reroll フレーバー・reward 数値）を受理する', () => {
    const partial: ScreenshotExtraction = {
      ...fullExtraction,
      result: { ...fullExtraction.result, final_score: null },
      upgrade_history: [{ week: 1, type: 'reroll', name: null, flavor: null }],
      reward_ledger: [{ name: 'BOHEMIAN', count: null, points: null }],
    }
    expect(ScreenshotExtractionSchema.safeParse(partial).success).toBe(true)
  })

  it('未知の section・非整数 week は拒否する', () => {
    expect(
      ScreenshotExtractionSchema.safeParse({
        ...fullExtraction,
        images: [{ index: 0, section: 'unknown' }],
      }).success,
    ).toBe(false)
    expect(
      ScreenshotExtractionSchema.safeParse({
        ...fullExtraction,
        upgrade_history: [{ week: 1.5, type: 'upgrade', name: 'X', flavor: null }],
      }).success,
    ).toBe(false)
  })
})

describe('extractionToFlatRecord', () => {
  it('フラット形（week/type/name|flavor）へ変換し、null キーを落とす', () => {
    const flat = extractionToFlatRecord({
      ...fullExtraction,
      result: { ...fullExtraction.result, final_score: null },
      reward_ledger: [{ name: 'BOHEMIAN', count: 1, points: null }],
    })
    expect(flat.result).not.toHaveProperty('final_score')
    expect(flat.result).toHaveProperty('days_survived', 10)
    expect(flat.upgrade_history).toEqual([
      { week: 1, type: 'upgrade', name: 'NUCLEAR WEAPONS LAB' },
      { week: 2, type: 'reroll', flavor: 'DIGITIZE CONSCIOUSNESS' },
    ])
    expect(flat.reward_ledger).toEqual([{ name: 'BOHEMIAN', count: 1 }])
  })
})

describe('screenshotExtractionJsonSchema', () => {
  it('object 型で主要プロパティを含み、$id が現行 schema_version を含む', () => {
    const schema = screenshotExtractionJsonSchema() as Record<string, unknown> & { $id?: string }
    expect(schema.type).toBe('object')
    const properties = schema.properties as Record<string, unknown>
    expect(properties).toHaveProperty('images')
    expect(properties).toHaveProperty('result')
    expect(properties).toHaveProperty('upgrade_history')
    expect(properties).toHaveProperty('reward_ledger')
    expect(schema.$id).toBe(SCREENSHOT_EXTRACTION_JSON_SCHEMA_ID)
    expect(SCREENSHOT_EXTRACTION_JSON_SCHEMA_ID).toContain(SCHEMA_VERSION)
  })

  it('全 object ノードに additionalProperties:false を持つ（OpenAI strict / codex 要件）', () => {
    const schema = screenshotExtractionJsonSchema()
    const objectNodes: Array<Record<string, unknown>> = []
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (node !== null && typeof node === 'object') {
        const obj = node as Record<string, unknown>
        if (obj.type === 'object' && obj.properties) objectNodes.push(obj)
        Object.values(obj).forEach(walk)
      }
    }
    walk(schema)
    // root + image + history entry + reward + result の 5 つ。
    expect(objectNodes.length).toBeGreaterThanOrEqual(5)
    for (const obj of objectNodes) expect(obj.additionalProperties).toBe(false)
  })
})
