// prd/01-game-domain.md §8 のサンプル run を正規スキーマ形へ起こしたテスト用フィクスチャ。
// upgrade_history は entry_type を持つ構造化形。reward 合計 = apocalypse_bonus(1208)。

import type { RunRecordInput } from '../schema'

/** 常に新しいオブジェクトを返す（テストが破壊的変更しても他へ波及しない）。 */
export function sampleRun(): RunRecordInput {
  return {
    game: 'UTOPIA MUST FALL',
    result: {
      days_survived: 10,
      final_score: 143161,
      aliens_defeated: 1336,
      nukes_launched: 3,
      apocalypse_bonus: 1208,
    },
    upgrade_history: [
      { entry_type: 'upgrade', week_index: 1, order_in_week: 1, name: 'NUCLEAR WEAPONS LAB' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 2, name: 'RATIONED WARHEADS' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 3, name: 'INCREASE PRODUCTION' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 4, name: 'ARC FLAIL' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 5, name: 'INCREASE FIRE RATE' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 6, name: 'REGENERATIVE SHIELD' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 7, name: 'BLACKOUT PROTOCOL' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 8, name: 'INSTITUTE OF AUTOMATION' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 9, name: 'DEPLOY LASER WATCHTOWER' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 10, name: 'DEPLOY LASER WATCHTOWER' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 11, name: 'PLASMA PHYSICS LAB' },
      { entry_type: 'upgrade', week_index: 1, order_in_week: 12, name: 'OPTIMIZED OPERATIONS' },
      { entry_type: 'upgrade', week_index: 2, order_in_week: 1, name: 'ADVANCED MATERIALS LAB' },
      {
        entry_type: 'reroll',
        week_index: 2,
        order_in_week: 2,
        flavor_text: 'DIGITIZE CONSCIOUSNESS',
      },
      { entry_type: 'upgrade', week_index: 2, order_in_week: 3, name: 'EXTENDED FLAIL' },
      { entry_type: 'upgrade', week_index: 2, order_in_week: 4, name: 'CONTEXT SWITCH' },
      { entry_type: 'reroll', week_index: 2, order_in_week: 5, flavor_text: 'WELCOMING CEREMONY' },
      {
        entry_type: 'upgrade',
        week_index: 2,
        order_in_week: 6,
        name: 'OFFENSIVE INNOVATION CENTER',
      },
      { entry_type: 'upgrade', week_index: 2, order_in_week: 7, name: 'COBALT COIL GUN' },
    ],
    reward_ledger: [
      { name: 'BOHEMIAN', count: 1, points: 250 },
      { name: 'OBSESSIVE', count: 21, points: 168 },
      { name: "CHEF'S KISS", count: 7, points: 140 },
      { name: 'CONSERVATION', count: 3, points: 120 },
      { name: 'NO ESCAPE', count: 3, points: 90 },
      { name: 'LASER DISCO', count: 3, points: 90 },
      { name: 'DISCIPLINE', count: 7, points: 70 },
      { name: 'ANNIHILATION', count: 13, points: 65 },
      { name: 'COMPLETIST', count: 11, points: 55 },
      { name: 'MINT CONDITION', count: 2, points: 50 },
      { name: 'GONNAHAVEMESOMEFUN', count: 2, points: 40 },
      { name: 'HARD CHEESE', count: 4, points: 40 },
      { name: 'CLOSE SHAVE', count: 1, points: 30 },
    ],
  }
}
