import {
  normalizeName,
  UPGRADE_SERIES_BY_NAME,
  UPGRADE_SERIES_INTENTIONALLY_UNCLASSIFIED,
} from 'shared'
import { describe, expect, it } from 'vitest'
import { REWARDS, UPGRADES } from '../catalog-data'

// seed.ts（= 観測された名前）と shared/series.ts（= ガイド由来の既知名）の関係:
//
//   seed ⊆ series
//
// series の側が広い（OU 20種・OVERWEIGHT BUNDLES など未観測の名前を含む）ため、逆方向は
// 制約にならない。この一方向だけを強制することで「seed に足したのに系統を付け忘れた」
// （＝分析画面で無言のうちに未分類グレーになる）事故を防ぐ。

describe('upgrade seed', () => {
  it('名前はすべて正規形（normalizeName で不変）', () => {
    for (const { name } of UPGRADES) {
      expect(normalizeName(name)).toBe(name)
    }
  })

  it('canonical_key の重複が無い', () => {
    const keys = UPGRADES.map((u) => normalizeName(u.name))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('seed の全名称は系統が付いているか、意図的に未分類と宣言されている', () => {
    const orphans = UPGRADES.map((u) => u.name).filter(
      (name) =>
        !(name in UPGRADE_SERIES_BY_NAME) && !UPGRADE_SERIES_INTENTIONALLY_UNCLASSIFIED.has(name),
    )
    expect(orphans).toEqual([])
  })

  it('意図的に未分類の名前に、うっかり系統が付いていない', () => {
    for (const name of UPGRADE_SERIES_INTENTIONALLY_UNCLASSIFIED) {
      expect(UPGRADE_SERIES_BY_NAME[name]).toBeUndefined()
    }
  })
})

describe('reward seed', () => {
  it('名前はすべて正規形（normalizeName で不変）', () => {
    for (const { name } of REWARDS) {
      expect(normalizeName(name)).toBe(name)
    }
  })

  it('canonical_key の重複が無い', () => {
    const keys = REWARDS.map((r) => normalizeName(r.name))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
