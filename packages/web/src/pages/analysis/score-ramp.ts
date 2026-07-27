// スコアの sequential ランプ（低→高 = 暗→明、indigo 単一 hue）。
// 記述分析のカードアクセントと傾向分析の点色で共用する。1 箇所に置くのは、
// 「どちらの図でも同じ明るさが同じスコア帯を意味する」ことをコードで担保するため。
// dataviz の指針: sequential は単一 hue の明度ランプ（レインボーにしない）。

/** スコアの基準色。散布図の点とランプ中央で共用する。 */
export const SCORE_COLOR = '#818cf8'

/** 低→高 = 暗→明。min-max を 5 段に量子化して使う。 */
export const SCORE_RAMP = ['#4338ca', '#6366f1', SCORE_COLOR, '#a5b4fc', '#c7d2fe'] as const

/** スコア不明（null）はアクセント無し（どの色でもランプ上の位置として誤読されるため）。 */
export const SCORE_UNKNOWN_COLOR = 'transparent'

/**
 * スコアをランプ上の色に写す。`min === max`（run が1件、または全て同点）ならランプ中央を返す
 * ——1点しかないのに端の色を出すと「低い/高い」と誤読されるため。
 */
export function scoreColor(score: number | null, min: number, max: number): string {
  if (score === null) return SCORE_UNKNOWN_COLOR
  if (max <= min) return SCORE_COLOR
  const t = (score - min) / (max - min)
  const index = Math.min(SCORE_RAMP.length - 1, Math.floor(t * SCORE_RAMP.length))
  return SCORE_RAMP[index] ?? SCORE_COLOR
}
