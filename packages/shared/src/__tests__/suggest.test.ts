import { describe, expect, it } from 'vitest'
import { damerauLevenshtein, homoglyphSkeleton, suggestSimilarNames } from '../suggest'

/** 実カタログから、似た名前が同居する部分を抜いた候補プール（提案先は verified のみの想定）。 */
const UPGRADES = [
  'RATIONED WARHEADS',
  'NUCLEAR WEAPONS LAB',
  'ARC FLAIL',
  'EXTENDED FLAIL',
  'INCREASE PRODUCTION',
  'INCREASE FIRE RATE',
  'DEPLOY LASER WATCHTOWER',
  'CONTEXT SWITCH',
]
const REWARDS = ['CLOSE SHAVE', 'BOHEMIAN', 'NO ESCAPE', 'HARD CHEESE', "CHEF'S KISS"]

describe('homoglyphSkeleton', () => {
  it('数字を紛らわしい文字へ寄せる（一方向のみ）', () => {
    expect(homoglyphSkeleton('CL0SE SHAVE')).toBe('CLOSE SHAVE')
    expect(homoglyphSkeleton('R4T10NED')).toBe('R4TIONED') // 4 は対応表に無いので触らない
    expect(homoglyphSkeleton('B0HEM1AN')).toBe('BOHEMIAN')
  })
  it('正しい名前（数字を含まない）は不変', () => {
    for (const name of [...UPGRADES, ...REWARDS]) expect(homoglyphSkeleton(name)).toBe(name)
  })
})

describe('damerauLevenshtein', () => {
  it('同一は 0 / 空文字は相手の長さ', () => {
    expect(damerauLevenshtein('ABC', 'ABC')).toBe(0)
    expect(damerauLevenshtein('', 'ABC')).toBe(3)
    expect(damerauLevenshtein('ABC', '')).toBe(3)
  })
  it('置換・挿入・脱落は 1', () => {
    expect(damerauLevenshtein('RATIONED', 'RATIONNED')).toBe(1) // 挿入
    expect(damerauLevenshtein('CLOSE', 'CL0SE')).toBe(1) // 置換
    expect(damerauLevenshtein('FLAIL', 'FLAI')).toBe(1) // 脱落
  })
  it('隣接の入れ替えは 1（Levenshtein なら 2）', () => {
    expect(damerauLevenshtein('ARC', 'ACR')).toBe(1)
  })
})

describe('suggestSimilarNames', () => {
  it('homoglyph の誤読を拾う（0 → O）', () => {
    const [top] = suggestSimilarNames('CL0SE SHAVE', REWARDS)
    expect(top).toMatchObject({ name: 'CLOSE SHAVE', homoglyph: true })
  })

  it('1 文字違いの誤読を拾う', () => {
    const [top] = suggestSimilarNames('RATIONNED WARHEADS', UPGRADES)
    expect(top).toMatchObject({ name: 'RATIONED WARHEADS', distance: 1, homoglyph: false })
  })

  it('完全一致する候補があれば提案しない（誤読ではない）', () => {
    expect(suggestSimilarNames('ARC FLAIL', UPGRADES)).toEqual([])
    // 正規化を通すので大小・空白の揺れも一致扱い。
    expect(suggestSimilarNames('  arc   flail ', UPGRADES)).toEqual([])
  })

  it('単語が重なるだけの別物は提案しない', () => {
    expect(suggestSimilarNames('INCREASE PRODUCTION RATE', UPGRADES)).toEqual([])
    expect(suggestSimilarNames('EXTENDED WATCHTOWER', UPGRADES)).toEqual([])
  })

  it('短い名前には距離 2 を許さない（無関係な名前を拾わないため）', () => {
    // NO ESCAPE(9) と NO ESCAPES(10) は距離 1 → 拾う
    expect(suggestSimilarNames('NO ESCAPES', REWARDS)[0]).toMatchObject({ name: 'NO ESCAPE' })
    // 距離 2 は短すぎるので拾わない
    expect(suggestSimilarNames('NO ESCAPERS', REWARDS)).toEqual([])
  })

  it('長い名前では 2 文字違いまで拾う', () => {
    const [top] = suggestSimilarNames('DEPLOY LASER WATCHTOWERS!', UPGRADES)
    expect(top).toMatchObject({ name: 'DEPLOY LASER WATCHTOWER', distance: 2 })
  })

  it('homoglyph 一致は距離の上限を超えていても優先して拾う', () => {
    // 距離 3 だが 0→O / 5→S / 1→I の畳み込みで一致する。
    const [top] = suggestSimilarNames('CL05E 5HAVE', REWARDS)
    expect(top).toMatchObject({ name: 'CLOSE SHAVE', homoglyph: true })
  })

  it('homoglyph 一致を距離だけの一致より前に並べる', () => {
    const results = suggestSimilarNames('B0HEMIAN', [...REWARDS, 'BOHEMIAM'])
    expect(results[0]).toMatchObject({ name: 'BOHEMIAN', homoglyph: true })
  })

  it('該当なし・空入力は空配列', () => {
    expect(suggestSimilarNames('TOTALLY UNKNOWN CONTRACT', UPGRADES)).toEqual([])
    expect(suggestSimilarNames('   ', UPGRADES)).toEqual([])
  })

  it('limit 件までに絞る', () => {
    expect(suggestSimilarNames('ARCX FLAILX', UPGRADES, 1).length).toBeLessThanOrEqual(1)
  })
})
