// スクショ自動解析（worker 経由のサーバ側 LLM）の出力契約。prd/04 §9.3。
// LLM CLI に「出力スキーマ強制」で従わせる Zod。ここから JSON Schema を導出して worker が使う。
//
// 設計:
//   - 読み取れない値は null にさせる（無理に埋めさせて幻覚数値を混入させない）。
//     null は変換でキーごと落とし、欠落として shared の Zod 検証（error）に拾わせる。
//   - upgrade_history は分析キットのフラット形 {week, type, name|flavor} と同じ語彙
//     （prd/04 §6。server の ingestion アダプタが order_in_week を振って正規形へ変換する）。
//   - images は入力画像の分類。index = worker が LLM に渡した画像の順番（0 始まり）。
//     worker が index → run_image.id へ引き直し、server が section を埋め戻す（prd/04 §9.1）。
//   - LLM 向けスキーマは discriminatedUnion を避けた平坦な形にする（構造化出力の実装差異に
//     耐えるよう、全キー必須 + 該当しない値は null で表現する）。

import { z } from 'zod'
import { ENTRY_TYPES } from './schema'
import { SCHEMA_VERSION } from './version'

/** 画像の分類先（run_image.section と同じ語彙。判別不能は other）。 */
export const EXTRACTION_SECTIONS = ['result', 'upgrade_history', 'reward_ledger', 'other'] as const
export type ExtractionSection = (typeof EXTRACTION_SECTIONS)[number]

const INT32_MAX = 2_147_483_647
const nonNegativeInt = z.int().min(0).max(INT32_MAX)
const positiveInt = z.int().min(1).max(INT32_MAX)
/** 読み取れない指標は null（欠落として扱う）。 */
const readableInt = nonNegativeInt.nullable()

/** 入力画像 1 枚の分類。 */
export const ExtractionImageSchema = z.object({
  index: nonNegativeInt,
  section: z.enum(EXTRACTION_SECTIONS),
})

/**
 * UPGRADE HISTORY の 1 行（フラット形）。
 * type=upgrade → name に表示名（綴りそのまま）、flavor は null。
 * type=reroll  → flavor に灰色斜体のフレーバー（読めなければ null）、name は null。
 */
export const ExtractionHistoryEntrySchema = z.object({
  week: positiveInt,
  type: z.enum(ENTRY_TYPES),
  name: z.string().min(1).nullable(),
  flavor: z.string().min(1).nullable(),
})

/** REWARD LEDGER の 1 行。name が読めない行は出力させない。数値が読めなければ null。 */
export const ExtractionRewardSchema = z.object({
  name: z.string().min(1),
  count: readableInt,
  points: readableInt,
})

/** 結果画面のコア指標。読み取れない値は null。 */
export const ExtractionResultSchema = z.object({
  days_survived: readableInt,
  final_score: readableInt,
  aliens_defeated: readableInt,
  nukes_launched: readableInt,
  apocalypse_bonus: readableInt,
})

/** スクショ一式（1 run 分）からの抽出結果。LLM の出力全体。 */
export const ScreenshotExtractionSchema = z.object({
  images: z.array(ExtractionImageSchema),
  result: ExtractionResultSchema,
  upgrade_history: z.array(ExtractionHistoryEntrySchema),
  reward_ledger: z.array(ExtractionRewardSchema),
})

export type ExtractionImage = z.infer<typeof ExtractionImageSchema>
export type ExtractionHistoryEntry = z.infer<typeof ExtractionHistoryEntrySchema>
export type ExtractionReward = z.infer<typeof ExtractionRewardSchema>
export type ScreenshotExtraction = z.infer<typeof ScreenshotExtractionSchema>

/** 現行 schema_version の抽出契約 JSON Schema を識別する `$id`。 */
export const SCREENSHOT_EXTRACTION_JSON_SCHEMA_ID =
  `utopia-must-fall/screenshot-extraction/${SCHEMA_VERSION}` as const

/**
 * JSON Schema の全 object ノードに `additionalProperties: false` を再帰的に付与する。
 * OpenAI 系の構造化出力（codex `--output-schema` 等の strict モード）は、各 object に
 * `additionalProperties: false` が明示されていないと `invalid_json_schema` で拒否する。
 * z.toJSONSchema は既定でこれを出さないため、CLI へ渡す前に補う。両 CLI とも無害
 * （未知キーを許さないのは元々望ましい挙動）なので CLI 中立のまま適用できる。
 */
function withNoAdditionalProperties<T>(node: T): T {
  if (Array.isArray(node)) {
    for (const item of node) withNoAdditionalProperties(item)
  } else if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (obj.type === 'object' && obj.properties) obj.additionalProperties = false
    for (const value of Object.values(obj)) withNoAdditionalProperties(value)
  }
  return node
}

/** 抽出契約の JSON Schema（worker が LLM CLI の出力スキーマ強制に使う）。 */
export function screenshotExtractionJsonSchema() {
  return withNoAdditionalProperties({
    ...z.toJSONSchema(ScreenshotExtractionSchema, { io: 'input' }),
    $id: SCREENSHOT_EXTRACTION_JSON_SCHEMA_ID,
  })
}

/**
 * 抽出結果を分析キットのフラット形レコード（ingestion アダプタ入力）へ変換する。
 * null（読めなかった値）はキーごと落とし、欠落として下流の Zod 検証に error として拾わせる
 * （幻覚値を混ぜるより、欠落を明示して解析失敗にする方が安全。prd/04 §9.5）。
 */
export function extractionToFlatRecord(extraction: ScreenshotExtraction): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extraction.result)) {
    if (value !== null) result[key] = value
  }
  return {
    result,
    upgrade_history: extraction.upgrade_history.map((e) =>
      e.type === 'reroll'
        ? { week: e.week, type: e.type, ...(e.flavor !== null && { flavor: e.flavor }) }
        : { week: e.week, type: e.type, ...(e.name !== null && { name: e.name }) },
    ),
    reward_ledger: extraction.reward_ledger.map((r) => ({
      name: r.name,
      ...(r.count !== null && { count: r.count }),
      ...(r.points !== null && { points: r.points }),
    })),
  }
}
