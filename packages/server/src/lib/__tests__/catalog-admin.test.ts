import { describe, expect, it } from 'vitest'
import { isOrphan, SEED_KEYS } from '../catalog-admin'

// 孤児 = 誤読の残骸（prd/08 §7）。4条件をすべて満たすものだけが削除対象。
// 1つでも欠ければ削除しない — 削除は取り消せないので、判定は保守側に倒す。

const orphan = {
  canonicalKey: 'THIN DRONE FACTORY', // codex の誤読（正: TWIN DRONE FACTORY）
  verified: false,
  refCount: 0,
  aliasCount: 0,
}

describe('isOrphan', () => {
  it('4条件をすべて満たすものは孤児', () => {
    expect(isOrphan(orphan, 'upgrade')).toBe(true)
  })

  it('参照が残っていれば孤児ではない', () => {
    expect(isOrphan({ ...orphan, refCount: 1 }, 'upgrade')).toBe(false)
  })

  it('別名の統合先なら孤児ではない（過去のマージが名寄せに使っている）', () => {
    expect(isOrphan({ ...orphan, aliasCount: 1 }, 'upgrade')).toBe(false)
  })

  it('verified なら孤児ではない', () => {
    expect(isOrphan({ ...orphan, verified: true }, 'upgrade')).toBe(false)
  })

  it('seed に載っている名前は孤児ではない（消しても再 seed で復活する）', () => {
    // 参照ゼロ・別名なし・未検証でも、seed 由来なら残す。
    expect(isOrphan({ ...orphan, canonicalKey: 'PULSE REFLEX', verified: false }, 'upgrade')).toBe(
      false,
    )
  })

  it('種別ごとに seed を見る（upgrade 名は reward の seed ではない）', () => {
    expect(isOrphan({ ...orphan, canonicalKey: 'CLOSE SHAVE' }, 'reward')).toBe(false)
    expect(isOrphan({ ...orphan, canonicalKey: 'CLOSE SHAVE' }, 'upgrade')).toBe(true)
  })
})

describe('SEED_KEYS', () => {
  it('seed の名前を種別ごとに持つ', () => {
    expect(SEED_KEYS.upgrade.has('TWIN DRONE FACTORY')).toBe(true)
    expect(SEED_KEYS.upgrade.has('THIN DRONE FACTORY')).toBe(false) // 誤読は seed に無い
    expect(SEED_KEYS.reward.has('CLOSE SHAVE')).toBe(true)
  })
})
