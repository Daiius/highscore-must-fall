// 正規スキーマ（Zod）。1 run を表す正規レコードの唯一の定義元（単一の真実）。
// ここから TS 型（z.infer）と JSON Schema（json-schema.ts）を導出する。
// ドメイン事実: prd/01-game-domain.md / 構造: prd/03-data-model.md §1

import { z } from 'zod'
import { normalizeName } from './normalize'
import { SCHEMA_VERSION } from './version'

/**
 * DB 側の格納可能範囲を contract に反映する上限。
 * shared で有効でも DB カラムをはみ出す値は保存時に 500/切り詰めになるため、
 * 検証層（保存前・全ルート共通）でここに収める（prd/03 §1・§3・prd/04 §4）。
 *   - INT カラム（days_survived 等・count・points）: MySQL 符号付き INT の最大値。
 *   - 名前・game（varchar(191)）: 191 文字。名前は正規化後の長さで判定する。
 */
const INT32_MAX = 2_147_483_647
const VARCHAR_MAX = 191

/** 結果指標・reward の count/points 用。負値・非整数・INT 範囲超過は error。 */
const nonNegativeInt = z.int().min(0).max(INT32_MAX)
/** 週番号・週内順など 1 以上の位置。 */
const positiveInt = z.int().min(1).max(INT32_MAX)

/**
 * catalog 名寄せ対象の名前（upgrade / reward）。
 * 正規レコードは正規形で確定させる（contract レベルで正規化を保証し、保存側の
 * 正規化忘れによる別カタログ登録を防ぐ）。原文は raw_payload が温存する。
 * 正規化後に空になる名前（制御文字のみ等）は空の canonical_key を生むため error。
 * → .claude/rules/schema-and-contract.md §名寄せ / prd/03 §1・§3.5
 */
const catalogName = z
  .string()
  .transform((s) => normalizeName(s))
  .refine((s) => s.length > 0, { message: '正規化後に空になる名前は使えません' })
  // 正規形は canonical_key / display_name（varchar(191)）に格納するため長さを contract で制限。
  .refine((s) => s.length <= VARCHAR_MAX, {
    message: `名前が長すぎます（正規化後 ${VARCHAR_MAX} 文字以内）`,
  })

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
    name: catalogName, // upgrade には name 必須（catalog 名寄せ対象）
  }),
  z.object({
    entry_type: z.literal('reroll'),
    week_index: positiveInt,
    order_in_week: positiveInt,
    // verbatim 保存（証跡・集計対象外）。前後空白も保持し、変換しない。空白のみは拒否。
    flavor_text: z
      .string()
      .refine((v) => v.trim().length > 0, { message: 'flavor_text が空白のみです' })
      .optional(),
  }),
])

/** REWARD LEDGER の 1 行（name / count 発生回数 / points 合計）。 */
export const RewardEntrySchema = z.object({
  name: catalogName,
  count: nonNegativeInt,
  points: nonNegativeInt,
})

/**
 * 1 run を表す正規レコード。全投入ルートがこれに収束する。
 * schema_version は現行版に固定。別版の入力は先に migrateToCurrent() で現行へ移してから通す。
 */
export const RunRecordSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  game: z.string().max(VARCHAR_MAX).default('UTOPIA MUST FALL'),
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
