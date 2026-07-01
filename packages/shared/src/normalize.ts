// 名寄せ正規化ヘルパー。投入名を「正規形」に整える。
// 正規形はそのまま表示にも使う（別の表示名を持たない）。
// ルール順序と根拠: ../../.claude/rules/schema-and-contract.md §名寄せ
//
//   1. ASCII フォールディング（Unicode の揺れを ASCII 等価へ / 制御文字除去）
//   2. 空白正規化（連続空白→単一スペース＋前後トリム）
//   3. 大文字化
//   4. ASCII 記号（' ! ? & . - 等）は保持（除去しない）
//
// OCR homoglyph（O↔0, I↔1, S↔5 等）は畳み込まない（誤マージ回避）。
//   → 類似候補は確定前レビューでサジェストし、人手で統合する。

/** 印刷用の引用符・ダッシュを ASCII 等価へ寄せる対応表。 */
const TYPOGRAPHIC_TO_ASCII: Readonly<Record<string, string>> = {
  '‘': "'", // left single quote
  '’': "'", // right single quote / apostrophe
  '‚': "'", // single low-9
  '‛': "'", // single high-reversed-9
  '“': '"', // left double quote
  '”': '"', // right double quote
  '„': '"', // double low-9
  '–': '-', // en dash
  '—': '-', // em dash
  '―': '-', // horizontal bar
  '−': '-', // minus sign
}

const TYPOGRAPHIC_RE = /[‘’‚‛“”„–—―−]/g

/**
 * 投入名を正規形へ整える。カタログの canonical_key かつ表示名として使う。
 * べき等（正規形をもう一度通しても不変）。
 */
export function normalizeName(input: string): string {
  const folded = input
    .normalize('NFKC') // 全角→半角・互換分解
    .replace(TYPOGRAPHIC_RE, (c) => TYPOGRAPHIC_TO_ASCII[c] ?? c)
    .normalize('NFD') // アクセントを基底文字＋結合記号へ分解
    .replace(/\p{M}/gu, '') // 結合記号（アクセント）除去

  return folded
    .replace(/\s+/g, ' ') // tab/改行/NBSP 等の空白系を単一スペースへ
    .replace(/\p{Cc}/gu, '') // 残った非空白の制御文字を除去
    .trim()
    .toUpperCase()
}

/** 2つの投入名が名寄せ上一致するか（正規形どうしの一致で判定）。 */
export function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b)
}
