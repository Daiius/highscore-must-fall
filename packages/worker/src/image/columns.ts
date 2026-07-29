// UPGRADE HISTORY のスクショを「列」に切り分ける前処理。
//
// なぜ要るか（実測・2026-07-30）:
//   UPGRADE HISTORY は生存日数が伸びると 3 列以上になる。この画面は列ごとに上から下へ読み、
//   列を跨いで並びが連続する（列の先頭に WEEK 見出しが無ければ前の列の週の続き）。
//   1 枚のまま読ませると、この継続を取り違えて**後ろの週が前の週へ丸ごと吸い込まれる**
//   （実測: WEEK 5 の 11 行が WEEK 4 に混入 / プロンプトで注意しても 4 回に 1 回再発）。
//   列ごとに切って渡すと読み順の曖昧さが構造的に消え、週の誤配と行の欠落が実測でゼロになった。
//
// 切ったあと 2 倍に拡大するのは、細長い列画像のままだとモデル側のリサイズで字が潰れるため
//   （実測: 362x823 のままだと EXTENDED BARREL を 4/4 で EXTENDED GARBAGE と誤読。
//    下部の空白を落として 2 倍にすると綴りの誤読が消えた）。
//
// 検出に失敗したら**何も返さない**（呼び出し側は元画像だけで従来どおり処理する）。
// 誤って切るより切らない方が安全なので、条件は厳しめに置く。
//
// 実画像 9 枚での実測（2026-07-30）: UPGRADE HISTORY 3 列→3 / 2 列→2 / 1 列→切らない、
// 結果画面→切らない、REWARD LEDGER→切らない（右揃えの表なので行が割れる。下の rightAlignedRatio）。

import { type DecodedImage, decodePng, encodeRgbPng, luminanceAt } from './png'

/** 文字とみなす輝度の下限。黒地に発光色の UI なので絶対値でよい。 */
const LIT = 60
/** 罫線とみなす「その行の明るい画素の割合」。 */
const RULE_RATIO = 0.5
/** 列間の空白帯と認める最小幅（画像幅に対する比 / 絶対値の大きい方）。 */
const GAP_RATIO = 0.01
const GAP_MIN_PX = 8
/** 列と認める最小幅（画像幅に対する比）。枠線や装飾を落とす。 */
const COLUMN_MIN_RATIO = 0.08
/** 列数がこの範囲に収まらなければ、UPGRADE HISTORY ではないとみなして分割しない。 */
const MIN_COLUMNS = 2
const MAX_COLUMNS = 8
/**
 * 本文行のうち「右端付近まで文字が届く行」の割合がこれを超えたら、右揃えの数値列を持つ表
 * （REWARD LEDGER）とみなして分割しない。実測: UPGRADE HISTORY 0.12〜0.19 / REWARD LEDGER 0.93〜0.98。
 */
const RIGHT_ALIGNED_RATIO = 0.5
/** 「右端付近」の定義（パネル幅に対する比）。 */
const RIGHT_EDGE_RATIO = 0.9
/** 拡大率。字の潰れを防ぐ。 */
const SCALE = 2
/** トリム後に残す下端の余白。 */
const BOTTOM_MARGIN = 6
/**
 * 列の左右に残す余白。列範囲は文字のバウンディングボックスぴったりに出るので、
 * そのまま切ると端の字のグロー（この UI は発光表現がある）が落ちる。
 */
const SIDE_PADDING = 6
/**
 * 受け付ける画素数の上限（幅 × 高さ）。4K 相当（3840x2160）の 2 倍強。
 * **展開前に**検査させる（`decodePng` の `maxPixels`）。
 */
const MAX_PIXELS = 20_000_000

/** 切り出した 1 列（PNG バイト列）。`index` は左から 0 始まり。 */
export interface ColumnImage {
  index: number
  png: Buffer
}

/** 明るい画素が行幅の RULE_RATIO を超える行 = パネルの罫線。 */
function findRuleRows(image: DecodedImage): number[] {
  const rows: number[] = []
  for (let y = 0; y < image.height; y++) {
    let lit = 0
    for (let x = 0; x < image.width; x++) if (luminanceAt(image, x, y) > LIT) lit++
    if (lit > image.width * RULE_RATIO) rows.push(y)
  }
  return rows
}

/** その行で明るい画素が途切れずに続く最長区間。 */
function longestLitSpan(image: DecodedImage, y: number): [number, number] {
  let best: [number, number] = [0, -1]
  let start: number | null = null
  for (let x = 0; x < image.width; x++) {
    const lit = luminanceAt(image, x, y) > LIT
    if (lit && start === null) start = x
    if ((!lit || x === image.width - 1) && start !== null) {
      const end = lit ? x : x - 1
      if (end - start > best[1] - best[0]) best = [start, end]
      start = null
    }
  }
  return best
}

/**
 * パネル（罫線で囲まれた矩形）の範囲を出す。
 *
 * **画面全体でなくパネルの内側だけを見る**のが要点。パネルの外には星や飛行中の敵機が居て、
 * 列間の空白帯を埋めてしまう（実測: 敵機が左右に居るスクショで列の切れ目を全て見失った）。
 *
 * 罫線行にはウィンドウの縁など画面幅いっぱいの線も混ざるので、各罫線行の最長区間の
 * **中央値**をパネルの左右とし、それに合致する行だけをパネルの罫線として上下に使う。
 */
function findPanel(
  image: DecodedImage,
  ruleRows: number[],
): { left: number; right: number; top: number; bottom: number } | null {
  const spans = ruleRows.map((y) => longestLitSpan(image, y))
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
  }
  const left = median(spans.map((s) => s[0]))
  const right = median(spans.map((s) => s[1]))
  if (right - left < image.width * 0.2) return null

  const tolerance = Math.max(4, Math.round(image.width * 0.02))
  const panelRows = ruleRows.filter((_, i) => {
    const span = spans[i]
    return (
      span !== undefined &&
      Math.abs(span[0] - left) <= tolerance &&
      Math.abs(span[1] - right) <= tolerance
    )
  })
  if (panelRows.length < 2) return null

  // 太さ数 px の罫線は複数行に出るので束ねる。本文はパネルの1本目と2本目の罫線の間。
  //
  // **最後の罫線まで含めてはいけない。** パネルの下側にはボタン（CLOSE）の区画があり、
  // 2 列レイアウトではボタンが**必ず中央の列間ギャップと重なって埋める**（実測: two-3 で
  // 列を1本も見つけられなくなった）。
  const groups: number[][] = []
  for (const y of panelRows) {
    const last = groups[groups.length - 1]
    if (last && y - (last[last.length - 1] ?? 0) <= 2) last.push(y)
    else groups.push([y])
  }
  const head = groups[0]
  if (!head) return null
  const top = head[head.length - 1] ?? 0
  const next = groups[1]
  const bottom = next ? (next[0] ?? 0) : (panelRows[panelRows.length - 1] ?? 0)
  return { left, right, top, bottom }
}

/**
 * 本文行のうち「右端付近まで文字が届く行」の割合。
 *
 * REWARD LEDGER は `NAME......12×..300` と**数値が右揃え**なので、ほぼ全行が右端に届く。
 * そのぶん行の途中に縦の空白が揃って立ち、列と誤認されて**行が分断される**（実測: 2 列の
 * REWARD LEDGER が 3 列に割れた）。UPGRADE HISTORY は左寄せで、右端に届くのは WEEK 見出しの
 * 点線だけなので、この比で切り分けられる。
 */
function rightAlignedRatio(
  image: DecodedImage,
  panel: { left: number; right: number },
  y0: number,
  y1: number,
  isRuleRow: Uint8Array,
): number {
  const threshold = panel.left + (panel.right - panel.left) * RIGHT_EDGE_RATIO
  let rows = 0
  let reaching = 0
  for (let y = y0; y <= y1; y++) {
    if (isRuleRow[y]) continue
    let rightmost = -1
    for (let x = panel.left + 3; x <= panel.right - 3; x++) {
      if (luminanceAt(image, x, y) > LIT) rightmost = x
    }
    if (rightmost < 0) continue
    rows++
    if (rightmost >= threshold) reaching++
  }
  return rows === 0 ? 0 : reaching / rows
}

/**
 * 罫線行を除いた列プロファイルの「完全な空白帯」で区切って列の x 範囲を出す。
 * 罫線を除くのは、パネル内を横断する区切り線が列間の空白を埋めてしまうため。
 */
function findColumnRanges(
  image: DecodedImage,
  panel: { left: number; right: number },
  y0: number,
  y1: number,
  isRuleRow: Uint8Array,
): [number, number][] {
  const x0 = panel.left + 3
  const x1 = panel.right - 3
  const width = x1 - x0 + 1
  const profile = new Int32Array(width)
  for (let y = y0; y <= y1; y++) {
    if (isRuleRow[y]) continue
    for (let x = x0; x <= x1; x++) {
      if (luminanceAt(image, x, y) > LIT) profile[x - x0] = (profile[x - x0] ?? 0) + 1
    }
  }

  const gapMin = Math.max(GAP_MIN_PX, Math.round(width * GAP_RATIO))
  const gaps: [number, number][] = []
  let start: number | null = null
  for (let x = 0; x < width; x++) {
    const empty = (profile[x] ?? 0) === 0
    if (empty && start === null) start = x
    if (!empty && start !== null) {
      if (x - start >= gapMin) gaps.push([start, x - 1])
      start = null
    }
  }
  if (start !== null && width - start >= gapMin) gaps.push([start, width - 1])

  // 空白帯の隙間 = 列候補。幅が足りないもの（枠線・装飾）は捨てる。
  const minWidth = Math.round(width * COLUMN_MIN_RATIO)
  const ranges: [number, number][] = []
  let cursor = 0
  for (const [gapStart, gapEnd] of gaps) {
    if (gapStart - cursor >= minWidth) ranges.push([cursor + x0, gapStart - 1 + x0])
    cursor = gapEnd + 1
  }
  if (width - cursor >= minWidth) ranges.push([cursor + x0, x1])
  return ranges
}

/** 列範囲を切り出し、下部の空白を落として SCALE 倍に拡大した PNG を作る。 */
function cropColumn(image: DecodedImage, x0: number, x1: number, y0: number, y1: number): Buffer {
  let lastLit = y0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (luminanceAt(image, x, y) > LIT) {
        lastLit = y
        break
      }
    }
  }
  const bottom = Math.min(y1, lastLit + BOTTOM_MARGIN)
  const w = x1 - x0 + 1
  const h = bottom - y0 + 1
  const out = Buffer.alloc(w * SCALE * h * SCALE * 3)
  const gray = image.channels <= 2
  for (let y = 0; y < h * SCALE; y++) {
    for (let x = 0; x < w * SCALE; x++) {
      const src =
        ((Math.floor(y / SCALE) + y0) * image.width + (Math.floor(x / SCALE) + x0)) * image.channels
      const dst = (y * w * SCALE + x) * 3
      const r = image.data[src] ?? 0
      out[dst] = r
      out[dst + 1] = gray ? r : (image.data[src + 1] ?? 0)
      out[dst + 2] = gray ? r : (image.data[src + 2] ?? 0)
    }
  }
  return encodeRgbPng(w * SCALE, h * SCALE, out)
}

/**
 * PNG バイト列を列画像に切り分ける。UPGRADE HISTORY らしい多列レイアウトでなければ
 * 空配列を返す（= 分割しない）。デコードできない形式・壊れた PNG でも throw せず空配列。
 */
export function splitIntoColumns(bytes: Buffer): ColumnImage[] {
  let image: DecodedImage
  try {
    image = decodePng(bytes, { maxPixels: MAX_PIXELS })
  } catch {
    return []
  }
  if (image.width < 100 || image.height < 100) return []

  // パネルの上下を囲む罫線が無い画面（結果画面など）は対象外。
  const ruleRows = findRuleRows(image)
  if (ruleRows.length < 2) return []
  const isRuleRow = new Uint8Array(image.height)
  for (const y of ruleRows) isRuleRow[y] = 1

  const panel = findPanel(image, ruleRows)
  if (!panel) return []
  const y0 = panel.top + 3
  const y1 = panel.bottom - 3
  if (y1 - y0 < 50) return []

  // 右揃えの数値列を持つ表は、行の途中の空白で割れて行そのものを壊すので触らない。
  if (rightAlignedRatio(image, panel, y0, y1, isRuleRow) > RIGHT_ALIGNED_RATIO) return []

  const ranges = findColumnRanges(image, panel, y0, y1, isRuleRow)
  if (ranges.length < MIN_COLUMNS || ranges.length > MAX_COLUMNS) return []

  return ranges.map(([x0, x1], index) => ({
    index,
    png: cropColumn(
      image,
      Math.max(panel.left + 1, x0 - SIDE_PADDING),
      Math.min(panel.right - 1, x1 + SIDE_PADDING),
      y0,
      y1,
    ),
  }))
}
