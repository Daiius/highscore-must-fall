// 手動修正フォームの状態 ⇄ 正規レコード（PUT /api/runs/:id/record の body）の変換。
// JSX から切り離して単体テストできるようにしてある。
//
// 設計上の要点:
//   - order_in_week は送らない。週内の連番は server 側アダプタが配列順から採番するため、
//     「行の並べ替え = 取得順の変更」がそのまま成立する。
//   - 代わりに配列は week_index 昇順で送る必要がある（contract の upgrade_history_out_of_order）。
//     JS の sort は安定なので、週でソートしても週内の順序は保たれる。
//   - 空欄は 0 に丸めず undefined にする。server の Zod に「必須項目が無い」と言わせるためで、
//     黙って 0 として保存されるほうが危ない。
//   - rawPayload を土台に spread する。schema_version / played_at / 未知の追加キーを落とさない。
//   - 各行は origin（保存時点の値）を持つ。1 字違いを直すつもりで消してしまっても元に戻せるように、
//     差分のある行に「元の値」と「戻す」を出すための土台。新規追加行は origin=null。

import type { RunDetailData } from './run-types'

/** 既存エントリの保存時点の値。差分表示・戻す・カタログバッジの有効判定に使う。 */
export interface HistoryOrigin {
  week: string
  type: 'upgrade' | 'reroll'
  name: string
  flavor: string
  /** 紐付いている upgrade_catalog の属性（表示のみ。名前を変えたら別エントリになるので無効化する）。 */
  kind: string | null
  verified: boolean | null
}

export interface HistoryRow {
  /** React の行キー。既存行はエントリ id、追加行は生成した UUID。 */
  key: string
  week: string
  type: 'upgrade' | 'reroll'
  /** type=upgrade のときの名前。type を切り替えても失わないよう flavor と別に持つ。 */
  name: string
  /** type=reroll のときの灰色フレーバー（verbatim 保存・集計対象外）。 */
  flavor: string
  origin: HistoryOrigin | null
}

export interface RewardOrigin {
  name: string
  count: string
  points: string
  verified: boolean | null
}

export interface RewardRow {
  key: string
  name: string
  count: string
  points: string
  origin: RewardOrigin | null
}

/** 追加行の React キー。既存行はエントリ id をそのまま使うので、ここでしか生成しない。 */
export function newRowKey(): string {
  return crypto.randomUUID()
}

export const RESULT_FIELDS = [
  { field: 'days_survived', label: '生存日数' },
  { field: 'final_score', label: 'スコア' },
  { field: 'aliens_defeated', label: '撃破エイリアン' },
  { field: 'nukes_launched', label: '発射核' },
  { field: 'apocalypse_bonus', label: 'ボーナス' },
] as const

export type ResultField = (typeof RESULT_FIELDS)[number]['field']
export type ResultForm = Record<ResultField, string>

export interface EditorState {
  result: ResultForm
  history: HistoryRow[]
  rewards: RewardRow[]
}

/** 数値入力の文字列 → 送信値。空欄は undefined（server が「必須項目が無い」と判定する）。 */
export function toNumber(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value)
}

/** 合計表示・整合チェックのプレビュー用。空欄や非数は 0 として足す（表示専用）。 */
export function sumPoints(rewards: RewardRow[]): number {
  return rewards.reduce((acc, r) => acc + (Number(r.points) || 0), 0)
}

const numberToInput = (value: number | null): string => (value == null ? '' : String(value))

/** run 詳細（子エントリ）から編集フォームの初期状態を作る。行キーはエントリ id をそのまま使う。 */
export function editorStateFromRun(run: RunDetailData): EditorState {
  return {
    result: {
      days_survived: numberToInput(run.daysSurvived),
      final_score: numberToInput(run.finalScore),
      aliens_defeated: numberToInput(run.aliensDefeated),
      nukes_launched: numberToInput(run.nukesLaunched),
      apocalypse_bonus: numberToInput(run.apocalypseBonus),
    },
    history: run.upgradeEntries.map((e) => {
      const origin: HistoryOrigin = {
        week: String(e.weekIndex),
        type: e.entryType,
        name: e.name ?? '',
        flavor: e.flavorText ?? '',
        kind: e.kind,
        verified: e.verified,
      }
      return { key: e.id, ...stripOrigin(origin), origin }
    }),
    rewards: run.rewardEntries.map((r) => {
      const origin: RewardOrigin = {
        name: r.name,
        count: String(r.count),
        points: String(r.points),
        verified: r.verified,
      }
      const { verified: _verified, ...values } = origin
      return { key: r.id, ...values, origin }
    }),
  }
}

/** origin の「値の部分」だけを取り出す（kind/verified はカタログ由来の表示属性で、編集対象ではない）。 */
function stripOrigin(origin: HistoryOrigin): Pick<HistoryRow, 'week' | 'type' | 'name' | 'flavor'> {
  return { week: origin.week, type: origin.type, name: origin.name, flavor: origin.flavor }
}

/** 保存時点から値が変わったか（新規追加行は常に「変更あり」扱いにしない＝元が無いので false）。 */
export function historyRowChanged(row: HistoryRow): boolean {
  if (!row.origin) return false
  const o = row.origin
  return (
    row.week !== o.week || row.type !== o.type || row.name !== o.name || row.flavor !== o.flavor
  )
}

export function rewardRowChanged(row: RewardRow): boolean {
  if (!row.origin) return false
  const o = row.origin
  return row.name !== o.name || row.count !== o.count || row.points !== o.points
}

/**
 * 名前が元のままか。カタログの未検証/OU バッジは「今リンクしている catalog エントリ」の属性なので、
 * 名前を変えた行では意味を失う（保存するまでどのエントリに寄るか決まらない）。表示の可否に使う。
 */
export function historyNamePristine(row: HistoryRow): boolean {
  return row.origin != null && row.type === row.origin.type && row.name === row.origin.name
}

export function rewardNamePristine(row: RewardRow): boolean {
  return row.origin != null && row.name === row.origin.name
}

/** 行を保存時点の値へ戻す（key と origin は保つ）。 */
export function revertHistoryRow(row: HistoryRow): HistoryRow {
  return row.origin ? { ...row, ...stripOrigin(row.origin) } : row
}

export function revertRewardRow(row: RewardRow): RewardRow {
  if (!row.origin) return row
  const { name, count, points } = row.origin
  return { ...row, name, count, points }
}

/** 履歴 1 行 → 正規形（order_in_week 抜き）。reroll の flavor は空白のみなら省く（verbatim 保持）。 */
function historyRowToEntry(row: HistoryRow): Record<string, unknown> {
  const base = { week_index: toNumber(row.week), entry_type: row.type }
  if (row.type === 'reroll') {
    return row.flavor.trim() === '' ? base : { ...base, flavor_text: row.flavor }
  }
  return { ...base, name: row.name.trim() }
}

/**
 * フォーム状態 → PUT する record。rawPayload の未知キーを温存しつつ、
 * upgrade_history は week_index 昇順（安定ソート）に整えて返す。
 */
export function buildRecord(run: RunDetailData, state: EditorState): Record<string, unknown> {
  const rawPayload = (run.rawPayload ?? {}) as Record<string, unknown>
  const rawResult = (rawPayload.result ?? {}) as Record<string, unknown>

  const history = state.history
    .map(historyRowToEntry)
    // 週が未入力（undefined）の行は 0 扱いで先頭へ寄せる。値の妥当性は server の Zod が弾く。
    .sort((a, b) => ((a.week_index as number) || 0) - ((b.week_index as number) || 0))

  return {
    ...rawPayload,
    game: run.game,
    result: {
      ...rawResult,
      days_survived: toNumber(state.result.days_survived),
      final_score: toNumber(state.result.final_score),
      aliens_defeated: toNumber(state.result.aliens_defeated),
      nukes_launched: toNumber(state.result.nukes_launched),
      apocalypse_bonus: toNumber(state.result.apocalypse_bonus),
    },
    upgrade_history: history,
    reward_ledger: state.rewards.map((r) => ({
      name: r.name.trim(),
      count: toNumber(r.count),
      points: toNumber(r.points),
    })),
  }
}
