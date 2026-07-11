import { describe, expect, it } from 'vitest'
import { summarizeVocabulary } from '../vocabulary'

// prd/06 §1.1: 未検証の語句も未分類の系統も、除外せず集計に乗せる。
// ここで固定するのは「除外しないが、件数は数えて注記に出す」という振る舞い。

describe('summarizeVocabulary', () => {
  it('未検証と未分類をそれぞれ数える（どちらも total から除外しない）', () => {
    const summary = summarizeVocabulary([
      { name: 'ARC FLAIL', verified: true }, // 分類済み・検証済み
      { name: 'ROBOTICS SPECIALIST', verified: false }, // 未分類・未検証
      { name: 'SUPERCONDUCTING POWER LINES', verified: true }, // 未分類・検証済み
      { name: 'PULSE REFLEX', verified: false }, // 分類済み・未検証
    ])
    expect(summary).toEqual({ total: 4, unverified: 2, unclassified: 2 })
  })

  it('カタログに無い名前（series 未収載）は未分類として数える', () => {
    const summary = summarizeVocabulary([{ name: 'CL0SE SHAVE', verified: false }])
    expect(summary).toEqual({ total: 1, unverified: 1, unclassified: 1 })
  })

  it('カタログ未紐付け（name=null）は数えない', () => {
    const summary = summarizeVocabulary([
      { name: null, verified: null },
      { name: 'ARC FLAIL', verified: true },
    ])
    expect(summary).toEqual({ total: 1, unverified: 0, unclassified: 0 })
  })

  it('空なら全て 0（注記は出ない）', () => {
    expect(summarizeVocabulary([])).toEqual({ total: 0, unverified: 0, unclassified: 0 })
  })
})
