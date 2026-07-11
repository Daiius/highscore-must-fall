import { describe, expect, it } from 'vitest'
import { firstSeenLink, isOrphan, planRewardMerge, SEED_KEYS } from '../catalog-admin'

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

// reward_entry は「run 内の1名前 = 1行」。マージでその不変条件を壊さない（回数・点も落とさない）。
describe('planRewardMerge', () => {
  it('衝突しない run は付け替えるだけ（回数・点はそのまま）', () => {
    const plan = planRewardMerge([{ id: 's1', runId: 'r1', count: 1, points: 30 }], [])
    expect(plan).toEqual({ updates: [{ id: 's1', count: 1, points: 30 }], deletes: [] })
  })

  it('同じ run に統合先の行があれば合算して1行に畳む', () => {
    const plan = planRewardMerge(
      [{ id: 's1', runId: 'r1', count: 1, points: 30 }],
      [{ id: 'a1', runId: 'r1', count: 2, points: 60 }],
    )
    expect(plan.updates).toEqual([{ id: 'a1', count: 3, points: 90 }])
    expect(plan.deletes).toEqual(['s1'])
  })

  it('同じ run に統合元の行が複数あっても回数・点を落とさない（HSF-59A72C47）', () => {
    // 1行ずつ統合先に足す実装だと、2行目の update が1行目の合算結果を上書きして 30 点が消える。
    const plan = planRewardMerge(
      [
        { id: 's1', runId: 'r1', count: 1, points: 30 },
        { id: 's2', runId: 'r1', count: 2, points: 40 },
      ],
      [{ id: 'a1', runId: 'r1', count: 1, points: 10 }],
    )
    expect(plan.updates).toEqual([{ id: 'a1', count: 4, points: 80 }])
    expect(plan.deletes).toEqual(['s1', 's2'])
  })

  it('統合先が無い run で統合元が複数でも、1行に畳んで合算する', () => {
    const plan = planRewardMerge(
      [
        { id: 's2', runId: 'r1', count: 2, points: 40 },
        { id: 's1', runId: 'r1', count: 1, points: 30 },
      ],
      [],
    )
    // 残す行は id 昇順の先頭（決定的）。
    expect(plan.updates).toEqual([{ id: 's1', count: 3, points: 70 }])
    expect(plan.deletes).toEqual(['s2'])
  })

  it('統合元が無い run（統合先だけ）は触らない', () => {
    const plan = planRewardMerge(
      [{ id: 's1', runId: 'r1', count: 1, points: 30 }],
      [
        { id: 'a1', runId: 'r1', count: 1, points: 10 },
        { id: 'a2', runId: 'r2', count: 5, points: 50 },
      ],
    )
    expect(plan.updates).toEqual([{ id: 'a1', count: 2, points: 40 }])
    expect(plan.deletes).toEqual(['s1'])
  })
})

// カタログはグローバルだが run は owner スコープ。admin でも他人の run 詳細は見られない（prd/05 §2）。
describe('firstSeenLink', () => {
  it('自分の run なら辿れる', () => {
    expect(firstSeenLink('run1', 'me', 'me')).toEqual({
      firstSeenRunId: 'run1',
      firstSeenRunExists: true,
    })
  })

  it('他ユーザーの run は id を出さない（押せば必ず 404 になる導線を置かない）', () => {
    expect(firstSeenLink('run1', 'someone-else', 'me')).toEqual({
      firstSeenRunId: null,
      firstSeenRunExists: true, // 「ある」ことは伝える
    })
  })

  it('初出 run が消えている（run 削除で SET NULL）なら存在しない', () => {
    expect(firstSeenLink(null, null, 'me')).toEqual({
      firstSeenRunId: null,
      firstSeenRunExists: false,
    })
  })
})

describe('SEED_KEYS', () => {
  it('seed の名前を種別ごとに持つ', () => {
    expect(SEED_KEYS.upgrade.has('TWIN DRONE FACTORY')).toBe(true)
    expect(SEED_KEYS.upgrade.has('THIN DRONE FACTORY')).toBe(false) // 誤読は seed に無い
    expect(SEED_KEYS.reward.has('CLOSE SHAVE')).toBe(true)
  })
})
