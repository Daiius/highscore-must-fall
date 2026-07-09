// 手動修正フォーム ⇄ 正規レコードの変換。server 側は shared の contract で再検証するため、
// ここでは「contract に食わせる直前の形」と「元の値へ戻せること」を確かめる。

import { describe, expect, it } from 'vitest'
import {
  buildRecord,
  editorStateFromRun,
  type HistoryRow,
  historyNamePristine,
  historyRowChanged,
  moveHistoryRow,
  type RewardRow,
  revertHistoryRow,
  revertRewardRow,
  rewardNamePristine,
  rewardRowChanged,
  sumPoints,
  toNumber,
} from '../run-record'
import type { RunDetailData } from '../run-types'

function makeRun(overrides: Partial<RunDetailData> = {}): RunDetailData {
  return {
    id: 'run-1',
    game: 'UTOPIA MUST FALL',
    playedAt: '2026-01-01T00:00:00.000Z',
    status: 'draft',
    finalScore: 143161,
    daysSurvived: 10,
    aliensDefeated: 1336,
    nukesLaunched: 3,
    apocalypseBonus: 1208,
    rerollCount: 1,
    upgradeEntries: [
      {
        id: 'u1',
        weekIndex: 1,
        orderInWeek: 1,
        entryType: 'upgrade',
        upgradeOrder: 1,
        flavorText: null,
        name: 'RATIONNED WARHEADS', // 誤読で unverified 自動登録された想定
        kind: 'contract',
        verified: false,
      },
      {
        id: 'u2',
        weekIndex: 2,
        orderInWeek: 1,
        entryType: 'reroll',
        upgradeOrder: null,
        flavorText: 'DIGITIZE CONSCIOUSNESS',
        name: null,
        kind: null,
        verified: null,
      },
    ],
    rewardEntries: [{ id: 'r1', name: 'BOHEMIAN', verified: true, count: 1, points: 1208 }],
    images: [],
    analysisJob: null,
    rawPayload: null,
    llmModel: null,
    sourceNote: null,
    ...overrides,
  }
}

const historyRow = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  key: 'k1',
  week: '1',
  type: 'upgrade',
  name: 'ARC FLAIL',
  flavor: '',
  origin: null,
  ...over,
})

const rewardRow = (over: Partial<RewardRow> = {}): RewardRow => ({
  key: 'k1',
  name: 'BOHEMIAN',
  count: '1',
  points: '250',
  origin: null,
  ...over,
})

describe('toNumber', () => {
  it('空欄は undefined（0 に丸めない）', () => {
    expect(toNumber('')).toBeUndefined()
    expect(toNumber('  ')).toBeUndefined()
  })
  it('数値は number に', () => {
    expect(toNumber('0')).toBe(0)
    expect(toNumber('1208')).toBe(1208)
  })
})

describe('sumPoints', () => {
  it('空欄・非数は 0 として合計する（表示用）', () => {
    expect(sumPoints([rewardRow({ points: '' })])).toBe(0)
    expect(sumPoints([rewardRow({ points: '250' }), rewardRow({ key: 'r2', points: '30' })])).toBe(
      280,
    )
  })
})

describe('editorStateFromRun', () => {
  it('子エントリからフォーム初期状態と origin を作る', () => {
    const state = editorStateFromRun(makeRun())
    expect(state.result.final_score).toBe('143161')
    // 行キーはエントリ id をそのまま使う（採番カウンタを持たない）。
    expect(state.history[0]).toEqual({
      key: 'u1',
      week: '1',
      type: 'upgrade',
      name: 'RATIONNED WARHEADS',
      flavor: '',
      origin: {
        week: '1',
        type: 'upgrade',
        name: 'RATIONNED WARHEADS',
        flavor: '',
        kind: 'contract',
        verified: false,
      },
    })
    expect(state.history[1]?.flavor).toBe('DIGITIZE CONSCIOUSNESS')
    expect(state.rewards[0]).toEqual({
      key: 'r1',
      name: 'BOHEMIAN',
      count: '1',
      points: '1208',
      origin: { name: 'BOHEMIAN', count: '1', points: '1208', verified: true },
    })
  })

  it('null のコア指標は空欄にする（部分 draft）', () => {
    const state = editorStateFromRun(makeRun({ finalScore: null }))
    expect(state.result.final_score).toBe('')
  })
})

describe('行の差分と「戻す」', () => {
  const origin = {
    week: '1',
    type: 'upgrade',
    name: 'RATIONNED WARHEADS',
    flavor: '',
    kind: null,
    verified: false,
  } as const

  it('名前を直すと変更ありになり、戻すと元へ復帰する', () => {
    const edited = historyRow({ name: 'RATIONED WARHEADS', origin })
    expect(historyRowChanged(edited)).toBe(true)
    expect(revertHistoryRow(edited).name).toBe('RATIONNED WARHEADS')
    expect(historyRowChanged(revertHistoryRow(edited))).toBe(false)
  })

  it('うっかり全部消しても元の名前は origin に残る', () => {
    const cleared = historyRow({ name: '', origin })
    expect(historyRowChanged(cleared)).toBe(true)
    expect(revertHistoryRow(cleared).name).toBe('RATIONNED WARHEADS')
  })

  it('新規追加行（origin=null）は変更扱いにせず、戻すも無操作', () => {
    const added = historyRow({ name: 'NEW', origin: null })
    expect(historyRowChanged(added)).toBe(false)
    expect(revertHistoryRow(added)).toEqual(added)
  })

  it('カタログバッジは名前が元のままの行にだけ出す（変えたら別エントリに寄るため）', () => {
    expect(historyNamePristine(historyRow({ name: 'RATIONNED WARHEADS', origin }))).toBe(true)
    expect(historyNamePristine(historyRow({ name: 'RATIONED WARHEADS', origin }))).toBe(false)
    // 種別を reroll に変えた行も、元の upgrade カタログの属性は無効。
    expect(
      historyNamePristine(historyRow({ type: 'reroll', name: 'RATIONNED WARHEADS', origin })),
    ).toBe(false)
    expect(historyNamePristine(historyRow({ origin: null }))).toBe(false)
  })

  it('reward も同様に差分・戻す・バッジ判定ができる', () => {
    const rOrigin = { name: 'BOHEMIAN', count: '1', points: '250', verified: false } as const
    const edited = rewardRow({ points: '260', origin: rOrigin })
    expect(rewardRowChanged(edited)).toBe(true)
    expect(rewardNamePristine(edited)).toBe(true) // 名前は変えていないのでバッジは有効
    expect(revertRewardRow(edited).points).toBe('250')
    expect(rewardNamePristine(rewardRow({ name: 'BOHEMIA', origin: rOrigin }))).toBe(false)
  })
})

describe('moveHistoryRow', () => {
  const history = [
    historyRow({ key: 'a', week: '1', name: 'A' }),
    historyRow({ key: 'b', week: '1', name: 'B' }),
    historyRow({ key: 'c', week: '2', name: 'C' }),
  ]

  it('同じ週の中では順序だけ入れ替える', () => {
    const moved = moveHistoryRow(history, 1, -1)
    expect(moved.map((r) => [r.key, r.week])).toEqual([
      ['b', '1'],
      ['a', '1'],
      ['c', '2'],
    ])
  })

  it('週をまたぐ移動では移動先の週を引き継ぐ（保存時のソートで戻らないように）', () => {
    // B(週1) を下へ → C(週2) の位置へ入るので週も 2 になる。
    const down = moveHistoryRow(history, 1, 1)
    expect(down.map((r) => [r.key, r.week])).toEqual([
      ['a', '1'],
      ['c', '2'],
      ['b', '2'],
    ])
    // C(週2) を上へ → B(週1) の位置へ入るので週も 1 になる。
    const up = moveHistoryRow(history, 2, -1)
    expect(up.map((r) => [r.key, r.week])).toEqual([
      ['a', '1'],
      ['c', '1'],
      ['b', '1'],
    ])
  })

  it('端では元の配列をそのまま返す', () => {
    expect(moveHistoryRow(history, 0, -1)).toBe(history)
    expect(moveHistoryRow(history, 2, 1)).toBe(history)
  })

  it('移動後に buildRecord へ通しても順序が保たれる（週で安定ソートしても崩れない）', () => {
    const state = editorStateFromRun(makeRun())
    state.history = moveHistoryRow(history, 1, 1) // B を週2 へ送る
    expect(buildRecord(makeRun(), state).upgrade_history).toEqual([
      { week_index: 1, entry_type: 'upgrade', name: 'A' },
      { week_index: 2, entry_type: 'upgrade', name: 'C' },
      { week_index: 2, entry_type: 'upgrade', name: 'B' },
    ])
  })
})

describe('buildRecord', () => {
  const run = makeRun()

  it('order_in_week は送らない（server 側アダプタが配列順から採番する）', () => {
    const record = buildRecord(run, editorStateFromRun(run))
    for (const entry of record.upgrade_history as Record<string, unknown>[]) {
      expect(entry).not.toHaveProperty('order_in_week')
    }
  })

  it('upgrade_history を week_index 昇順へ安定ソートする（週内の順序は保つ）', () => {
    const state = editorStateFromRun(run)
    state.history = [
      historyRow({ key: 'h1', week: '2', name: 'B1' }),
      historyRow({ key: 'h2', week: '1', name: 'A1' }),
      historyRow({ key: 'h3', week: '2', name: 'B2' }),
      historyRow({ key: 'h4', week: '1', name: 'A2' }),
    ]
    expect(buildRecord(run, state).upgrade_history).toEqual([
      { week_index: 1, entry_type: 'upgrade', name: 'A1' },
      { week_index: 1, entry_type: 'upgrade', name: 'A2' },
      { week_index: 2, entry_type: 'upgrade', name: 'B1' },
      { week_index: 2, entry_type: 'upgrade', name: 'B2' },
    ])
  })

  it('reroll の flavor は空白のみなら省き、そうでなければ verbatim で送る', () => {
    const state = editorStateFromRun(run)
    state.history = [
      historyRow({ key: 'h1', type: 'reroll', flavor: '   ' }),
      historyRow({ key: 'h2', type: 'reroll', flavor: '  WELCOMING CEREMONY ' }),
    ]
    expect(buildRecord(run, state).upgrade_history).toEqual([
      { week_index: 1, entry_type: 'reroll' },
      { week_index: 1, entry_type: 'reroll', flavor_text: '  WELCOMING CEREMONY ' },
    ])
  })

  it('未入力の数値は undefined のまま（0 に化けさせない）', () => {
    const state = editorStateFromRun(run)
    state.result.final_score = ''
    state.rewards = [rewardRow({ name: 'A', count: '', points: '' })]
    const record = buildRecord(run, state)
    expect((record.result as Record<string, unknown>).final_score).toBeUndefined()
    expect(record.reward_ledger).toEqual([{ name: 'A', count: undefined, points: undefined }])
  })

  it('rawPayload の schema_version / played_at / 未知キーを温存する', () => {
    const withPayload = makeRun({
      rawPayload: {
        schema_version: '0.1.0',
        game: 'UTOPIA MUST FALL',
        played_at: '2026-01-01T00:00:00.000Z',
        result: {
          days_survived: 10,
          final_score: 143161,
          aliens_defeated: 1336,
          nukes_launched: 3,
          apocalypse_bonus: 1208,
          future_metric: 42, // 未知の追加指標（ResultSchema は looseObject）
        },
        upgrade_history: [],
        reward_ledger: [],
      },
    })
    const record = buildRecord(withPayload, editorStateFromRun(withPayload))
    expect(record.schema_version).toBe('0.1.0')
    expect(record.played_at).toBe('2026-01-01T00:00:00.000Z')
    expect((record.result as Record<string, unknown>).future_metric).toBe(42)
    // 履歴・報酬はフォームの内容で置き換わる（payload の空配列は残らない）。
    expect(record.upgrade_history).toHaveLength(2)
    expect(record.reward_ledger).toHaveLength(1)
  })

  it('名前は前後の空白を落として送る（正規化は contract 側でも走る）', () => {
    const state = editorStateFromRun(run)
    state.history = [historyRow({ name: '  ARC FLAIL  ' })]
    state.rewards = [rewardRow({ name: ' BOHEMIAN ' })]
    const record = buildRecord(run, state)
    expect(record.upgrade_history).toEqual([
      { week_index: 1, entry_type: 'upgrade', name: 'ARC FLAIL' },
    ])
    expect(record.reward_ledger).toEqual([{ name: 'BOHEMIAN', count: 1, points: 250 }])
  })
})
