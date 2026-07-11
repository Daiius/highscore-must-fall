// 分析に載っているアップグレード語句の内訳（未検証・系統未分類の件数）。
//
// **どちらも集計から除外しない**（prd/06 §1.1）。誤読や新要素が混ざっていても分析は動かし、
// 「揺れがありうる」ことだけを控えめに知らせる。除外すると、ゲーム更新直後＝分析がいちばん
// 欲しい時期に、新要素を含む run が丸ごと分析から消える。
//
// 数えるのは **語句の種類数**（取得回数ではない）。「読み違いが何語混ざっているか」が知りたい
// 情報であって、その語が何回取られたかは注記の趣旨と関係ない。

import { upgradeSeriesOf } from 'shared'

export interface VocabularyRow {
  name: string | null
  /** カタログ未紐付け（leftJoin の欠損）は null。 */
  verified: boolean | null
}

export interface VocabularySummary {
  /** 分析に載っているアップグレード名の種類数。 */
  total: number
  /** うちスクショ未検証（unverified 自動登録のまま）の語句数。 */
  unverified: number
  /** うち系統が未分類（unknown バケット）の語句数。 */
  unclassified: number
}

export function summarizeVocabulary(rows: readonly VocabularyRow[]): VocabularySummary {
  const named = rows.filter((r): r is VocabularyRow & { name: string } => r.name != null)
  return {
    total: named.length,
    unverified: named.filter((r) => r.verified === false).length,
    unclassified: named.filter((r) => upgradeSeriesOf(r.name) === 'unknown').length,
  }
}
