// 列分割の前処理（image/columns.ts）。合成画像で「切る条件」と「切らない条件」を固定する。
//
// 実画像での実測（2026-07-30・9 枚）:
//   UPGRADE HISTORY 3 列 → 3 列 / 2 列 → 2 列 / 1 列 → 分割せず
//   結果画面 → 分割せず / REWARD LEDGER → 分割せず（行が割れるため触らない）
// ここではその判断基準が壊れないことを押さえる。

import { constants, deflateSync } from 'node:zlib'
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

/** PNG チャンクの CRC32（特殊な PNG をテスト内で組み立てるために要る）。 */
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

/** 長さ + 種別 + 中身 + CRC の PNG チャンク。 */
function chunk(type: string, payload: Buffer): Buffer {
  const out = Buffer.alloc(8 + payload.length + 4)
  out.writeUInt32BE(payload.length, 0)
  out.write(type, 4, 'ascii')
  payload.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + payload.length)), 8 + payload.length)
  return out
}

/** 生データ（フィルタ種別込み）とカラータイプから PNG を組み立てる。 */
function buildPng(raw: Buffer, colorType: number, extra: Buffer = Buffer.alloc(0)): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(WIDTH, 0)
  ihdr.writeUInt32BE(HEIGHT, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    extra,
    chunk('IDAT', deflateSync(raw, { level: constants.Z_BEST_COMPRESSION })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 「切れば 2 列になる」生データを作る（フィルタは全行 0 = None）。
 * `channels` は 1=grayscale / 3=truecolor。破損や透過の検証で、**正常なら切れる**画像を
 * 土台にするために要る（全面 0 の画像だと「罫線が無いので切らない」に落ちて区別できない）。
 */
function twoColumnRaw(channels: 1 | 3): Buffer {
  const stride = WIDTH * channels
  const raw = Buffer.alloc(HEIGHT * (stride + 1))
  const put = (x: number, y: number, value: number) => {
    const base = y * (stride + 1) + 1 + x * channels
    for (let c = 0; c < channels; c++) raw[base + c] = value
  }
  for (let x = PANEL_LEFT; x <= PANEL_RIGHT; x++) {
    put(x, PANEL_TOP, 200)
    put(x, PANEL_BOTTOM, 200)
  }
  let row = 0
  for (let y = PANEL_TOP + 20; y < PANEL_BOTTOM - 10; y += 4, row++) {
    for (let x = 30; x <= 180 - (row % 4) * 24; x += 2) put(x, y, 200)
    for (let x = 230; x <= 380 - (row % 4) * 24; x += 2) put(x, y, 200)
  }
  return raw
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

  // alpha を捨てて RGB だけ写すと、透明画素に非黒の RGB を持つ PNG で「検出時には見えなかった色」
  // が切り出し画像に現れ、文字や列間の空白を覆う。列画像の側が読み取りの原本になるので実害が出る。
  describe('透明画素の隠し色を持ち込まない', () => {
    /** 透明部に非黒 RGB を仕込んだ alpha 付き PNG を作る（2ch = gray+alpha / 4ch = RGBA）。 */
    const withHiddenColor = (channels: 2 | 4): Buffer => {
      const stride = WIDTH * channels
      const raw = Buffer.alloc(HEIGHT * (stride + 1))
      const put = (x: number, y: number, value: number, alpha: number) => {
        const base = y * (stride + 1) + 1 + x * channels
        raw[base] = value
        if (channels === 4) {
          raw[base + 1] = value
          raw[base + 2] = value
        }
        raw[base + channels - 1] = alpha
      }
      // 全面を「不透明な黒」で埋めてから、パネル枠と 2 列の本文を描く
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) put(x, y, 0, 255)
      for (let x = PANEL_LEFT; x <= PANEL_RIGHT; x++) {
        put(x, PANEL_TOP, 200, 255)
        put(x, PANEL_BOTTOM, 200, 255)
      }
      let row = 0
      for (let y = PANEL_TOP + 20; y < PANEL_BOTTOM - 10; y += 4, row++) {
        for (let x = 30; x <= 180 - (row % 4) * 24; x += 2) put(x, y, 200, 255)
        for (let x = 230; x <= 380 - (row % 4) * 24; x += 2) put(x, y, 200, 255)
      }
      // **左列の内側**（テキスト行の隙間）を「完全に透明だが RGB は真っ白」で塗る。
      // 列の外に置くと切り出し範囲に入らず、alpha を捨てる実装でもテストが通ってしまう。
      // 不透明な画素の最大値は 200 なので、255 が出てきたら隠し色が漏れたと判る。
      for (let y = PANEL_TOP + 22; y < PANEL_BOTTOM - 12; y += 4) {
        for (let x = 30; x <= 180; x++) put(x, y, 255, 0)
      }
      const chunk = (type: string, payload: Buffer): Buffer => {
        const out = Buffer.alloc(8 + payload.length + 4)
        out.writeUInt32BE(payload.length, 0)
        out.write(type, 4, 'ascii')
        payload.copy(out, 8)
        out.writeUInt32BE(crc32(out.subarray(4, 8 + payload.length)), 8 + payload.length)
        return out
      }
      const ihdr = Buffer.alloc(13)
      ihdr.writeUInt32BE(WIDTH, 0)
      ihdr.writeUInt32BE(HEIGHT, 4)
      ihdr[8] = 8
      ihdr[9] = channels === 4 ? 6 : 4
      return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: constants.Z_BEST_COMPRESSION })),
        chunk('IEND', Buffer.alloc(0)),
      ])
    }

    for (const channels of [2, 4] as const) {
      it(`${channels === 4 ? 'RGBA' : 'gray+alpha'} の透明画素は黒として切り出す`, () => {
        const columns = splitIntoColumns(withHiddenColor(channels))
        expect(columns).toHaveLength(2)
        const left = decodePng((columns[0] as { png: Buffer }).png)
        let brightest = 0
        for (const value of left.data) brightest = Math.max(brightest, value)
        // 不透明な文字は 200、隠した透明画素は 255。255 が出たら alpha を捨てている。
        expect(brightest).toBe(200)
      })
    }
  })

  // 圧縮された PNG はアップロード上限に収まっていても展開後は桁違いに大きくなりうる。
  // 展開してから画素数を見ていては、制限が効く前に inflate と画素バッファ確保が走る。
  it('展開後が巨大になる PNG は、展開する前に諦める', () => {
    // IHDR の幅・高さだけを巨大な値に差し替える（圧縮データは小さいまま = 展開後に膨らむ形）。
    // CRC も振り直す。壊れたチャンクとして弾かれてしまうと、サイズ検査の順序を検証できない。
    const forged = Buffer.from(synthesize([{ x0: 30, x1: 180 }]))
    forged.writeUInt32BE(60_000, 16)
    forged.writeUInt32BE(60_000, 20)
    forged.writeUInt32BE(crc32(forged.subarray(12, 29)), 29)

    const before = process.memoryUsage().heapTotal
    expect(splitIntoColumns(forged)).toEqual([])
    // 36 億画素ぶんのバッファを確保していない（確保していれば OOM か大幅増になる）
    expect(process.memoryUsage().heapTotal - before).toBeLessThan(100 * 1024 * 1024)
  })

  // 壊れた PNG を 0 埋めで復号すると、それが偶然列検出条件を満たしたときに壊れた列画像が
  // 作られる。プロンプトは「列画像から読む」と指示するので、誤読がそのまま保存されてしまう。
  describe('壊れた PNG は元画像へのフォールバックに落とす', () => {
    const valid = () =>
      Buffer.from(
        synthesize([
          { x0: 30, x1: 180 },
          { x0: 230, x1: 380 },
        ]),
      )

    // **IHDR の CRC だけ**を壊す。IDAT を壊すと zlib 自身のチェックサムが先に落ちるので、
    // CRC 検証の有無を区別できない（中身は正しいまま CRC だけ不一致にする必要がある）。
    it('チャンクの CRC が合わなければ切らない', () => {
      const forged = valid()
      forged.writeUInt32BE(forged.readUInt32BE(29) ^ 0xffffffff, 29)
      expect(splitIntoColumns(forged)).toEqual([])
    })

    it('展開後の長さが足りなければ切らない', () => {
      // 高さだけを倍にする（圧縮データはそのまま = 展開後が期待より短くなる）
      const forged = valid()
      forged.writeUInt32BE(HEIGHT * 2, 20)
      forged.writeUInt32BE(crc32(forged.subarray(12, 29)), 29)
      expect(splitIntoColumns(forged)).toEqual([])
    })

    it('IEND に到達しなければ切らない', () => {
      const forged = valid()
      expect(splitIntoColumns(forged.subarray(0, forged.length - 12))).toEqual([])
    })

    // **フィルタ以外は正常で、切れば 2 列になる画像**にする。全面 0 の画像だと検証が無くても
    // 「罫線が無いので切らない」になってしまい、フィルタ検証の有無を区別できない。
    it('未知の行フィルタがあれば切らない', () => {
      const raw = twoColumnRaw(3)
      expect(splitIntoColumns(buildPng(raw, 2))).toHaveLength(2) // 比較対象

      raw[0] = 5 // 1 行目のフィルタ種別だけ未知の値にする
      expect(splitIntoColumns(buildPng(raw, 2))).toEqual([])
    })
  })

  // alpha チャンネルを持たない grayscale / truecolor では、tRNS が「この色は透明」を意味する。
  // 解釈せずに使うと、元画像では透明だった画素が切り出し画像に不透明な色として現れる
  // （alpha 付きで塞いだのと同じ穴が別の経路で開く）。扱えないので元画像へ落とす。
  describe('tRNS（カラーキー透過）付きは切らない', () => {
    const cases = [
      { label: 'truecolor', colorType: 2, channels: 3 as const, trns: Buffer.alloc(6) },
      { label: 'grayscale', colorType: 0, channels: 1 as const, trns: Buffer.alloc(2) },
    ]
    for (const { label, colorType, channels, trns } of cases) {
      it(`${label} + tRNS は切らない`, () => {
        const raw = twoColumnRaw(channels)
        // tRNS が無ければ 2 列に切れる画像であることを先に確かめる（比較対象）
        expect(splitIntoColumns(buildPng(raw, colorType))).toHaveLength(2)
        expect(splitIntoColumns(buildPng(raw, colorType, chunk('tRNS', trns)))).toEqual([])
      })
    }
  })
})
