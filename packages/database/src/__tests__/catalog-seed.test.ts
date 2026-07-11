import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
//
// 同様に、seed の evidence と prd/samples/ の関係:
//
//   seed ⊆ samples
//
// evidence（= verified の根拠）が指す画像は必ず実在すること。画像を消す/改名すれば落ちる。
// 逆方向（画像に写っているが seed に無い名前）は許す（prd/08 §3）。

/** prd/samples/ に実在する画像の evidence 識別子（拡張子なしのファイル名）。 */
const SAMPLE_IDS: ReadonlySet<string> = new Set(
  readdirSync(fileURLToPath(new URL('../../../../prd/samples', import.meta.url)))
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -'.png'.length)),
)

describe('prd/samples', () => {
  it('画像が1枚以上ある（パスの取り違えでテストが空振りしない）', () => {
    expect(SAMPLE_IDS.size).toBeGreaterThan(0)
  })
})

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

  it('evidence は prd/samples/ に実在する画像を指す', () => {
    const missing = UPGRADES.filter((u) => u.evidence !== null && !SAMPLE_IDS.has(u.evidence)).map(
      (u) => `${u.name} -> ${u.evidence}`,
    )
    expect(missing).toEqual([])
  })

  // upgrade が写るのは UPGRADE HISTORY = contracts section だけ（prd/samples/README.md §1）。
  // reward 用の画像を貼り違えても存在チェックは通ってしまうので、section も見る。
  it('evidence は contracts section の画像である', () => {
    const wrongSection = UPGRADES.filter(
      (u) => u.evidence !== null && !u.evidence.startsWith('contracts'),
    ).map((u) => `${u.name} -> ${u.evidence}`)
    expect(wrongSection).toEqual([])
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

  it('evidence は prd/samples/ に実在する画像を指す', () => {
    const missing = REWARDS.filter((r) => r.evidence !== null && !SAMPLE_IDS.has(r.evidence)).map(
      (r) => `${r.name} -> ${r.evidence}`,
    )
    expect(missing).toEqual([])
  })

  it('evidence は rewards section の画像である', () => {
    const wrongSection = REWARDS.filter(
      (r) => r.evidence !== null && !r.evidence.startsWith('rewards'),
    ).map((r) => `${r.name} -> ${r.evidence}`)
    expect(wrongSection).toEqual([])
  })
})
