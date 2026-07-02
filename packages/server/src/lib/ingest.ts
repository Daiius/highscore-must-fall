// ingestion アダプタ（段階1: ファイル/貼り付け）。
//
//   1. parseSubmission : 投入テキスト（JSON/YAML）を素の JS 値へ。
//   2. toCanonicalRunRecord : 分析キットの「フラット形」を正規スキーマ形へ 1:1 変換
//      （prd/04 §6・analysis-kit/）。週内の連番 = order_in_week を振るのがアダプタの仕事。
//   3. 以降の「検証 → 整合チェック」は shared の validateRunRecord に収束する（投入経路非依存）。
//
// フラット形（人間/汎用 LLM が書く。analysis-kit/template.yaml）:
//   upgrade_history: [{ week, type: upgrade, name } | { week, type: reroll, flavor }]
//   result / reward_ledger のキーは正規スキーマと同一。
// 正規形（contract。shared/schema.ts）:
//   upgrade_history: [{ week_index, order_in_week, entry_type, name } | { ..., flavor_text }]
//
// 変換は防御的（入力は unknown）。マッピングできない値はそのまま素通しし、shared の Zod 検証に
// 明確な error として拾わせる（ここでは握りつぶさない）。正規形が来た場合もそのまま通る
// （week_index/entry_type/order_in_week を優先採用するため冪等）。

import { type ValidationResult, validateRunRecord } from 'shared'
import { parse as parseYaml } from 'yaml'

export type SubmissionFormat = 'json' | 'yaml' | 'auto'

export interface ParseSuccess {
  ok: true
  /** パース済みの素の値。 */
  value: unknown
  /** 実際に採用したフォーマット（auto の解決結果）。 */
  format: 'json' | 'yaml'
}

export interface ParseFailure {
  ok: false
  /** パース失敗の理由（UI 表示用）。 */
  message: string
}

export type ParseResult = ParseSuccess | ParseFailure

/**
 * 投入テキストを JS 値へパースする。YAML は JSON の上位集合なので、auto では
 * まず JSON を試し、失敗したら YAML にフォールバックする（エラーメッセージを分かりやすくするため）。
 */
export function parseSubmission(text: string, format: SubmissionFormat = 'auto'): ParseResult {
  if (text.trim().length === 0) {
    return { ok: false, message: '入力が空です' }
  }
  if (format === 'json') return tryJson(text)
  if (format === 'yaml') return tryYaml(text)

  const asJson = tryJson(text)
  if (asJson.ok) return asJson
  const asYaml = tryYaml(text)
  if (asYaml.ok) return asYaml
  return asYaml // YAML は JSON を包含するので YAML 側のメッセージを返す。
}

function tryJson(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text), format: 'json' }
  } catch (e) {
    return { ok: false, message: `JSON パースに失敗しました: ${errMessage(e)}` }
  }
}

function tryYaml(text: string): ParseResult {
  try {
    return { ok: true, value: parseYaml(text), format: 'yaml' }
  } catch (e) {
    return { ok: false, message: `YAML パースに失敗しました: ${errMessage(e)}` }
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * フラット形の 1 履歴エントリを正規形へ。週内の連番（order_in_week）は per-week カウンタで採番する。
 * 正規形のキー（week_index/order_in_week/entry_type/flavor_text）が既にあればそれを優先する。
 */
function toCanonicalHistoryEntry(raw: unknown, counters: Map<unknown, number>): unknown {
  if (!isRecord(raw)) return raw

  const weekIndex = raw.week_index ?? raw.week
  const nextInWeek = (counters.get(weekIndex) ?? 0) + 1
  counters.set(weekIndex, nextInWeek)
  const orderInWeek = raw.order_in_week ?? nextInWeek
  const entryType = raw.entry_type ?? raw.type

  const base = { week_index: weekIndex, order_in_week: orderInWeek, entry_type: entryType }

  if (entryType === 'reroll') {
    const flavorText = raw.flavor_text ?? raw.flavor
    // flavor は任意。存在するときだけ載せる（undefined を明示しない）。
    return flavorText === undefined ? base : { ...base, flavor_text: flavorText }
  }
  // upgrade（および未知の type。未知は shared の discriminatedUnion が error にする）。
  return { ...base, name: raw.name }
}

/**
 * 分析キットのフラット形レコードを正規スキーマ形へ変換する。
 * result / reward_ledger はキーが正規形と同一なので素通し。upgrade_history のみ変換する。
 */
export function toCanonicalRunRecord(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const history = raw.upgrade_history
  if (!Array.isArray(history)) return raw // 配列でなければそのまま（Zod が error にする）。

  const counters = new Map<unknown, number>()
  return { ...raw, upgrade_history: history.map((e) => toCanonicalHistoryEntry(e, counters)) }
}

/** 検証結果 + パース失敗の統一表現（route が UI 向けに一本化して返す）。 */
export interface IngestResult extends ValidationResult {
  /** 採用フォーマット（パース失敗時は null）。 */
  format: 'json' | 'yaml' | null
}

/**
 * 投入テキストを「パース → フラット形→正規形 変換 → shared 検証」まで一気通貫で処理する。
 * validate / 保存の両ルートが共通で使う入口。パース不能も error 1 件の検証結果に載せる。
 */
export function ingestSubmission(text: string, format: SubmissionFormat = 'auto'): IngestResult {
  const parsed = parseSubmission(text, format)
  if (!parsed.ok) {
    return {
      ok: false,
      format: null,
      issues: [{ level: 'error', code: 'parse_error', message: parsed.message, path: [] }],
    }
  }
  const canonical = toCanonicalRunRecord(parsed.value)
  return { ...validateRunRecord(canonical), format: parsed.format }
}
