// 列分割の前処理（image/columns.ts）。合成画像で「切る条件」と「切らない条件」を固定する。
//
// 実画像での実測（2026-07-30・9 枚）:
//   UPGRADE HISTORY 3 列 → 3 列 / 2 列 → 2 列 / 1 列 → 分割せず
//   結果画面 → 分割せず / REWARD LEDGER → 分割せず（行が割れるため触らない）
// ここではその判断基準が壊れないことを押さえる。

import { describe, expect, it } from 'vitest'
import { splitIntoColumns } from '../image/columns'
import { decodePng, encodeRgbPng } from '../image/png'

const WIDTH = 600
const HEIGHT = 400
/** パネル枠。実画像でも本文はパネルの内側にあり、パネル端まで文字は来ない。 */
const PANEL_LEFT = 10
const PANEL_RIGHT = WIDTH - 10
const PANEL_TOP = 10
const PANEL_BOTTOM = HEIGHT - 10

interface Block {
  x0: number
  x1: number
}

interface Options {
  /** パネルの罫線を描くか（結果画面のように枠が無い画面を作るとき false）。 */
  rules?: boolean
  /** 全行を右端まで伸ばす（REWARD LEDGER のように数値が右揃えの表）。 */
  rightAligned?: boolean
  /** 本文の下にボタン区画を作る（罫線をもう 1 本引き、中央にボタンを置く）。 */
  footer?: boolean
}

/**
 * 黒地にパネル枠と本文ブロックを描いた PNG を作る。
 *
 * ブロックは 1 つ飛ばしで塗り、**行ごとに右端をばらつかせる**。実画像の文字行は行幅を
 * 塗りつぶさず（字間・字画の隙間）、左寄せで行ごとに長さが違う。塗りつぶすとテキスト行まで
 * 罫線と判定され、右端を揃えると右揃えの表（REWARD LEDGER）と判定される。
 */
function synthesize(blocks: Block[], { rules = true, rightAligned, footer }: Options = {}): Buffer {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3)
  const paint = (x: number, y: number) => {
    const i = (y * WIDTH + x) * 3
    rgb[i] = 200
    rgb[i + 1] = 200
    rgb[i + 2] = 200
  }
  const rule = (y: number) => {
    for (let x = PANEL_LEFT; x <= PANEL_RIGHT; x++) paint(x, y)
  }
  const bodyBottom = footer ? HEIGHT - 90 : PANEL_BOTTOM
  if (rules) {
    rule(PANEL_TOP)
    rule(bodyBottom)
    if (footer) rule(PANEL_BOTTOM)
  }
  for (const { x0, x1 } of blocks) {
    let row = 0
    for (let y = PANEL_TOP + 20; y < bodyBottom - 10; y += 4, row++) {
      const end = rightAligned ? x1 : x1 - (row % 4) * 24
      for (let x = x0; x <= end; x += 2) paint(x, y)
    }
  }
  // ボタン（CLOSE 相当）。本文の列間ギャップと同じ x に来るのが 2 列レイアウトの実態。
  if (footer) {
    for (let y = HEIGHT - 70; y < HEIGHT - 30; y++) {
      for (let x = WIDTH / 2 - 40; x < WIDTH / 2 + 40; x++) paint(x, y)
    }
  }
  return encodeRgbPng(WIDTH, HEIGHT, rgb)
}

describe('splitIntoColumns', () => {
  it('罫線で囲まれた多列レイアウトを列ごとに切る', () => {
    const png = synthesize([
      { x0: 30, x1: 180 },
      { x0: 230, x1: 380 },
      { x0: 420, x1: 560 },
    ])
    expect(splitIntoColumns(png).map((c) => c.index)).toEqual([0, 1, 2])
  })

  // パネルの下にはボタンの区画があり、2 列レイアウトではボタンが**必ず中央の列間ギャップと
  // 重なる**。本文をパネル下端まで取ると列を 1 本も見つけられなくなる（実測 two-3）。
  it('パネル下部のボタン区画に列間を潰されない', () => {
    const png = synthesize(
      [
        { x0: 30, x1: 270 },
        { x0: 330, x1: 560 },
      ],
      { footer: true },
    )
    expect(splitIntoColumns(png)).toHaveLength(2)
  })

  // 列間を横断する罫線は、列プロファイル上の空白を埋めてしまう。罫線行を集計から
  // 外していないと「1 列」に見えて分割できなくなる。
  it('パネル内を横断する区切り線があっても列を見つける', () => {
    const png = synthesize([
      { x0: 30, x1: 180 },
      { x0: 230, x1: 380 },
    ])
    const image = decodePng(png)
    const rgb = Buffer.from(image.data)
    for (let x = PANEL_LEFT; x <= PANEL_RIGHT; x++) {
      const i = (200 * WIDTH + x) * 3
      rgb[i] = 200
      rgb[i + 1] = 200
      rgb[i + 2] = 200
    }
    expect(splitIntoColumns(encodeRgbPng(WIDTH, HEIGHT, rgb))).toHaveLength(2)
  })

  // パネルの外には星や飛行中の敵機が居る。画面全体で列プロファイルを取ると、これらが
  // 列間の空白を埋めて切れ目を見失う（実測: 敵機が左右に居るスクショで全列を見失った）。
  it('パネルの外にある背景（星・敵機）に列間を潰されない', () => {
    const png = synthesize([
      { x0: 30, x1: 180 },
      { x0: 230, x1: 380 },
    ])
    const image = decodePng(png)
    const rgb = Buffer.from(image.data)
    for (let y = 100; y < 300; y += 3) {
      for (const x of [2, 5, WIDTH - 4, WIDTH - 2]) {
        const i = (y * WIDTH + x) * 3
        rgb[i] = 180
        rgb[i + 1] = 180
        rgb[i + 2] = 180
      }
    }
    expect(splitIntoColumns(encodeRgbPng(WIDTH, HEIGHT, rgb))).toHaveLength(2)
  })

  it('切り出した列は元の色を保つ（リロールの灰色斜体を落とさない）', () => {
    const rgb = Buffer.alloc(WIDTH * HEIGHT * 3)
    for (let x = PANEL_LEFT; x <= PANEL_RIGHT; x++) {
      for (const y of [PANEL_TOP, PANEL_BOTTOM]) {
        const i = (y * WIDTH + x) * 3
        rgb[i] = 200
        rgb[i + 1] = 200
        rgb[i + 2] = 200
      }
    }
    // 左列は赤、右列は緑（字面と同じく 1 つ飛ばし・行ごとに長さを変える）
    let row = 0
    for (let y = PANEL_TOP + 20; y < PANEL_BOTTOM - 10; y += 4, row++) {
      for (let x = 30; x <= 180 - (row % 4) * 24; x += 2) rgb[(y * WIDTH + x) * 3] = 220
      for (let x = 230; x <= 380 - (row % 4) * 24; x += 2) rgb[(y * WIDTH + x) * 3 + 1] = 220
    }
    const columns = splitIntoColumns(encodeRgbPng(WIDTH, HEIGHT, rgb))
    expect(columns).toHaveLength(2)
    const brightest = (png: Buffer, channel: number) => {
      const image = decodePng(png)
      let max = 0
      for (let i = channel; i < image.data.length; i += 3) max = Math.max(max, image.data[i] ?? 0)
      return max
    }
    const [left, right] = columns
    expect(brightest((left as { png: Buffer }).png, 0)).toBeGreaterThan(200) // 赤が残る
    expect(brightest((left as { png: Buffer }).png, 1)).toBe(0) // 緑は混ざらない
    expect(brightest((right as { png: Buffer }).png, 1)).toBeGreaterThan(200)
    expect(brightest((right as { png: Buffer }).png, 0)).toBe(0)
  })

  // 分割は補助であって前提ではない。判断がつかないものは切らずに元画像で進ませる。
  it('パネルの罫線が無い画面（結果画面など）は切らない', () => {
    const png = synthesize(
      [
        { x0: 30, x1: 180 },
        { x0: 230, x1: 380 },
      ],
      { rules: false },
    )
    expect(splitIntoColumns(png)).toEqual([])
  })

  // REWARD LEDGER は数値が右揃えで、行の途中に縦の空白が揃って立つ。列と誤認して切ると
  // 名前・回数・点数が別画像に分かれて**行そのものが壊れる**（実測: 2 列が 3 列に割れた）。
  it('右揃えの数値列を持つ表（REWARD LEDGER）は切らない', () => {
    const png = synthesize(
      [
        { x0: 30, x1: 280 },
        { x0: 330, x1: 560 },
      ],
      { rightAligned: true },
    )
    expect(splitIntoColumns(png)).toEqual([])
  })

  it('列が 1 本しか無ければ切らない', () => {
    expect(splitIntoColumns(synthesize([{ x0: 30, x1: 560 }]))).toEqual([])
  })

  it('細すぎる帯（枠線や装飾）は列として数えない', () => {
    const columns = splitIntoColumns(
      synthesize([
        { x0: 14, x1: 17 }, // 枠線相当
        { x0: 50, x1: 280 },
        { x0: 330, x1: 560 },
      ]),
    )
    expect(columns).toHaveLength(2)
  })

  it('PNG でないバイト列は切らない（throw しない）', () => {
    expect(splitIntoColumns(Buffer.from('not a png'))).toEqual([])
  })
})
