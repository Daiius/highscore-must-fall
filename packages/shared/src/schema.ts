// 正規スキーマ（Zod）。1 run を表す正規レコードの唯一の定義元（単一の真実）。
// ここから TS 型（z.infer）と JSON Schema（json-schema.ts）を導出する。
// ドメイン事実: prd/01-game-domain.md / 構造: prd/03-data-model.md §1

import { z } from 'zod'
import { SCHEMA_VERSION } from './version'

/** 結果指標・reward の count/points 用。負値・非整数は error。 */
const nonNegativeInt = z.int().min(0)
/** 週番号・週内順など 1 以上の位置。 */
const positiveInt = z.int().min(1)

/** 履歴エントリの種別。第3種は存在しない（prd/01 §3.1）。 */
export const ENTRY_TYPES = ['upgrade', 'reroll'] as const

/**
 * 結果画面のコア指標。未知の追加指標は温存する（loose=raw_payload 用）。
 * prd/01 §4 / prd/03 §1。
 */
export const ResultSchema = z.looseObject({
  days_survived: nonNegativeInt,
  final_score: nonNegativeInt, // 分析の主対象
  aliens_defeated: nonNegativeInt,
  nukes_launched: nonNegativeInt,
  apocalypse_bonus: nonNegativeInt, // = Σ(reward_ledger.points)。整合チェック対象
})

/**
 * UPGRADE HISTORY の 1 エントリ。週グループ + 週内取得順を保持する。
 * entry_type で upgrade / reroll を判別（prd/01 §3.1・prd/03 §1）。
 *   - upgrade: name 必須（catalog 名寄せ対象）
 *   - reroll : flavor_text 任意（灰色フレーバー / verbatim・集計対象外）
 */
export const UpgradeHistoryEntrySchema = z.discriminatedUnion('entry_type', [
  z.object({
    entry_type: z.literal('upgrade'),
    week_index: positiveInt,
    order_in_week: positiveInt,
    name: z.string().trim().min(1, 'upgrade には name が必須'),
  }),
  z.object({
    entry_type: z.literal('reroll'),
    week_index: positiveInt,
    order_in_week: positiveInt,
    flavor_text: z.string().trim().min(1).optional(),
  }),
])

/** REWARD LEDGER の 1 行（name / count 発生回数 / points 合計）。 */
export const RewardEntrySchema = z.object({
  name: z.string().trim().min(1),
  count: nonNegativeInt,
  points: nonNegativeInt,
})

/** 1 run を表す正規レコード。全投入ルートがこれに収束する。 */
export const RunRecordSchema = z.object({
  schema_version: z.string().default(SCHEMA_VERSION),
  game: z.string().default('UTOPIA MUST FALL'),
  played_at: z.iso.datetime({ offset: true }).optional(), // 省略時はサーバが投入時刻を補完
  result: ResultSchema,
  upgrade_history: z.array(UpgradeHistoryEntrySchema), // 順序保持
  reward_ledger: z.array(RewardEntrySchema),
})

export type EntryType = (typeof ENTRY_TYPES)[number]
export type Result = z.infer<typeof ResultSchema>
export type UpgradeHistoryEntry = z.infer<typeof UpgradeHistoryEntrySchema>
export type RewardEntry = z.infer<typeof RewardEntrySchema>
export type RunRecord = z.infer<typeof RunRecordSchema>
/** パース前の入力型（default 付きフィールドは任意）。投入 UI/クライアント用。 */
export type RunRecordInput = z.input<typeof RunRecordSchema>
