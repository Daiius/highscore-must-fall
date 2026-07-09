// 読み取りミス疑いの「もしかしてこれ？」候補検出。
// 正規化（normalize.ts）は誤マージを避けるため homoglyph を畳み込まない。畳み込まずに残した情報を、
// ここで**候補のサジェストにだけ**使う（保存キーには使わない）。
// → .claude/rules/schema-and-contract.md §名寄せ「確定前レビューで類似候補としてサジェスト → 人手統合」
//
// 提案先は verified なカタログ名に限る。unverified 同士（誤読 → 別の誤読）を提案しても意味がないため、
// 呼び出し側が verified だけを candidates に渡すこと。

import { normalizeName } from './normalize'

/**
 * OCR / LLM が取り違えやすい「数字 → 文字」の対応。
 * 現行カタログの正規名に数字を含むものは無いため、数字側を文字へ寄せる一方向だけを畳み込めば
 * 正しい名前どうしが衝突することはない（`I↔L` のような文字↔文字は誤マージを生むので畳み込まない）。
 */
const DIGIT_TO_LETTER: Readonly<Record<string, string>> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
}

/** homoglyph を畳み込んだ比較用キー。`CL0SE SHAVE` と `CLOSE SHAVE` が一致する。 */
export function homoglyphSkeleton(name: string): string {
  return name.replace(/[012568]/g, (d) => DIGIT_TO_LETTER[d] ?? d)
}

/**
 * 許容する編集距離。短い名前ほど厳しくする（`NO ESCAPE` に距離 2 を許すと無関係な名前を拾う）。
 * 1 文字違いは常に許し、長い名前でだけ 2〜3 文字違いまで見る。
 */
function maxDistanceFor(length: number): number {
  return Math.min(3, Math.max(1, Math.floor(length * 0.12)))
}

/**
 * Damerau-Levenshtein 距離（隣接転置を 1 とする OSA 版）。
 * 誤読は「1 文字の置換・脱落・挿入・隣接の入れ替え」に偏るため、素の Levenshtein より当たりが良い。
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // 直前 2 行だけ保持するローリング配列（全行を持つ必要はない）。
  let twoAgo: number[] = []
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  let current: number[] = new Array(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      // biome-ignore lint/style/noNonNullAssertion: ループ不変条件で [0..b.length] は必ず埋まっている
      let value = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost)
      // 隣接する 2 文字の入れ替え（AB → BA）。
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        // biome-ignore lint/style/noNonNullAssertion: 上の i>1 && j>1 で twoAgo[j-2] は存在する
        value = Math.min(value, twoAgo[j - 2]! + cost)
      }
      current[j] = value
    }
    twoAgo = previous
    previous = current
    current = new Array(b.length + 1)
  }
  // biome-ignore lint/style/noNonNullAssertion: 最終行の末尾は必ず埋まっている
  return previous[b.length]!
}

export interface NameSuggestion {
  /** 候補（正規形＝表示名）。 */
  name: string
  /** input からの編集距離。 */
  distance: number
  /** homoglyph（`0`↔`O` 等）を畳み込むと一致するか。確度が高い。 */
  homoglyph: boolean
}

/**
 * input に近い candidates を確度順に返す。完全一致する候補があれば「誤読ではない」として空を返す。
 *
 * 採用条件は 2 つで、どちらかを満たせば候補にする:
 *   1. homoglyph を畳み込むと一致する（`CL0SE SHAVE` → `CLOSE SHAVE`）
 *   2. 編集距離が maxDistanceFor 以内（`RATIONNED WARHEADS` → `RATIONED WARHEADS`）
 *
 * 単語の重なり（`INCREASE PRODUCTION` と `INCREASE FIRE RATE`）は意図的に見ない。
 * 誤読ではなく別物であることが多く、提案の信頼性を落とすため。
 */
export function suggestSimilarNames(
  input: string,
  candidates: readonly string[],
  limit = 3,
): NameSuggestion[] {
  const key = normalizeName(input)
  if (key.length === 0) return []

  const normalized = candidates.map(normalizeName)
  if (normalized.includes(key)) return []

  const skeleton = homoglyphSkeleton(key)
  const found: NameSuggestion[] = []
  for (const candidate of normalized) {
    const homoglyph = homoglyphSkeleton(candidate) === skeleton
    const limitForPair = maxDistanceFor(Math.max(key.length, candidate.length))
    // 長さが離れすぎていれば距離も必ず超える（重い距離計算を避ける前フィルタ）。
    if (!homoglyph && Math.abs(key.length - candidate.length) > limitForPair) continue

    const distance = damerauLevenshtein(key, candidate)
    if (homoglyph || distance <= limitForPair) found.push({ name: candidate, distance, homoglyph })
  }

  found.sort(
    (a, b) =>
      Number(b.homoglyph) - Number(a.homoglyph) ||
      a.distance - b.distance ||
      a.name.localeCompare(b.name),
  )
  return found.slice(0, limit)
}
