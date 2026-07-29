// PNG の最小デコーダ / エンコーダ（依存ゼロ・node:zlib のみ）。
//
// UPGRADE HISTORY の列分割（./columns.ts）だけのために置く。画像ライブラリを worker の
// 依存に足さないのは、常駐コンテナへ持ち込む native 依存を増やしたくないため
// （node:22-slim + tsx 直接実行という Dockerfile の構成を崩さない）。
//
// `scripts/evidence-sheet.mjs` にも同種のコーデックがあるが、共有しない:
//   - worker のイメージには `scripts/` が入らない（Dockerfile は packages/{shared,server,worker} のみ）
//   - あちらは証拠シートの**決定論**の本体で、`--verify` の画素一致検証が乗っている。
//     こちらの都合で触ると証拠の再現性を壊す。
//   - あちらは輝度化した 8bit グレースケール出力。UPGRADE HISTORY は**色に意味がある**
//     （リロール = 灰色斜体）ので RGB のまま扱う必要があり、出力側は共有できない。

import { constants, deflateSync, inflateSync } from 'node:zlib'

/** デコード済み画像。`data` は channels ごとの生画素（幅 × 高さ × channels）。 */
export interface DecodedImage {
  width: number
  height: number
  /** 1=gray / 2=gray+alpha / 3=rgb / 4=rgba */
  channels: number
  data: Buffer
}

const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** 行フィルタの種別（0=None / 1=Sub / 2=Up / 3=Average / 4=Paeth）。 */
const MAX_FILTER_TYPE = 4

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 幅・高さの上限。`width * height` が number の安全整数を超えないための歯止め。 */
const MAX_DIMENSION = 100_000

export interface DecodeOptions {
  /** 展開後の画素数（幅 × 高さ）の上限。**inflate する前に**検査する。 */
  maxPixels?: number
}

/**
 * PNG（8bit・非インタレース）をデコードする。対応外の形式は throw する
 * （呼び出し側は列分割を諦めて元画像のまま進む）。
 *
 * **サイズの検査は展開前に行う。** 圧縮された PNG はアップロード上限に収まっていても
 * 展開後は桁違いに大きくなりうる（zip bomb）。展開してから画素数を見ていては、
 * 制限が効く前に同期 inflate と画素バッファ確保が走り、worker が OOM で落ちる
 * ＝「分割に失敗したら元画像で続ける」フォールバックにも到達できない。
 */
export function decodePng(bytes: Buffer, options: DecodeOptions = {}): DecodedImage {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('PNG: シグネチャが違う')
  }
  let offset = 8
  let header: {
    width: number
    height: number
    depth: number
    color: number
    interlace: number
  } | null = null
  const idat: Buffer[] = []
  let transparency = false
  let ended = false
  while (!ended) {
    // **壊れた PNG は必ず throw させる**（呼び出し側は元画像へフォールバックする）。
    // 黙って 0 埋めで復号すると、それが偶然列検出条件を満たしたときに壊れた列画像が
    // 作られ、しかもプロンプトは「列画像から読む」と指示するので誤読が保存されてしまう。
    if (offset + 12 > bytes.length) throw new Error('PNG: チャンクが途中で切れている')
    const length = bytes.readUInt32BE(offset)
    if (length > 0x7fffffff || offset + 12 + length > bytes.length) {
      throw new Error('PNG: チャンク長が不正')
    }
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
      bytes.readUInt32BE(offset + 8 + length)
    ) {
      throw new Error(`PNG: ${type} チャンクの CRC が合わない`)
    }
    if (type === 'IHDR') {
      if (header) throw new Error('PNG: IHDR が複数ある')
      if (length !== 13) throw new Error('PNG: IHDR の長さが不正')
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8] ?? 0,
        color: body[9] ?? 0,
        interlace: body[12] ?? 0,
      }
    } else if (type === 'IDAT') {
      if (!header) throw new Error('PNG: IHDR より前に IDAT がある')
      idat.push(body)
    } else if (type === 'tRNS') {
      transparency = true
    } else if (type === 'IEND') {
      ended = true
    }
    offset += 12 + length
  }
  if (!header) throw new Error('PNG: IHDR が無い')
  if (header.depth !== 8 || header.interlace !== 0) {
    throw new Error(`PNG: 8bit 非インタレースのみ対応（depth=${header.depth}）`)
  }
  const channels = CHANNELS_BY_COLOR_TYPE[header.color]
  if (!channels) throw new Error(`PNG: 未対応のカラータイプ ${header.color}`)
  // alpha チャンネルを持たない grayscale / truecolor では、tRNS が「この色は透明」を意味する。
  // 解釈せずに使うと、元画像では透明だった画素が切り出し画像に不透明な色として現れる
  // （alpha 付きで直したのと同じ穴が、別の経路で開く）。扱えないので元画像へ落とす。
  if (transparency && (header.color === 0 || header.color === 2)) {
    throw new Error('PNG: tRNS（カラーキー透過）付きは未対応')
  }

  const { width, height } = header
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`PNG: 寸法が範囲外（${width}x${height}）`)
  }
  const { maxPixels } = options
  if (maxPixels !== undefined && width * height > maxPixels) {
    throw new Error(`PNG: 画素数が上限を超えます（${width}x${height} > ${maxPixels}）`)
  }

  if (idat.length === 0) throw new Error('PNG: IDAT が無い')

  const stride = width * channels
  // 非インタレースの生データは「フィルタ種別 1 byte + 1 行」の繰り返しで、長さが確定する。
  // inflate の出力をここで打ち切れば、展開後の巨大化そのものを防げる（上限超過は throw）。
  const expectedRawLength = height * (stride + 1)
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedRawLength })
  // 短ければ足りない画素が 0 で埋まる＝切り詰められた画像を正常として通してしまう。
  if (raw.length !== expectedRawLength) {
    throw new Error(`PNG: 展開後の長さが合わない（${raw.length} != ${expectedRawLength}）`)
  }
  const data = Buffer.alloc(height * stride)
  let read = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[read++] ?? 0
    if (filter > MAX_FILTER_TYPE) throw new Error(`PNG: 未知の行フィルタ ${filter}`)
    const line = raw.subarray(read, read + stride)
    read += stride
    const cur = data.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (cur[x - channels] ?? 0) : 0
      const b = prev ? (prev[x] ?? 0) : 0
      const c = prev && x >= channels ? (prev[x - channels] ?? 0) : 0
      let value = line[x] ?? 0
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = value & 0xff
    }
  }
  return { width, height, channels, data }
}

/** RGB 8bit（カラータイプ 2）で PNG バイト列にする。`rgb` は 幅 × 高さ × 3。 */
export function encodeRgbPng(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1)
    raw[base] = 2 // Up filter。横に走る UI の罫線と字面によく効く
    for (let x = 0; x < stride; x++) {
      const up = y > 0 ? (rgb[(y - 1) * stride + x] ?? 0) : 0
      raw[base + 1 + x] = ((rgb[y * stride + x] ?? 0) - up) & 0xff
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  const chunk = (type: string, payload: Buffer): Buffer => {
    const out = Buffer.alloc(8 + payload.length + 4)
    out.writeUInt32BE(payload.length, 0)
    out.write(type, 4, 'ascii')
    payload.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + payload.length)), 8 + payload.length)
    return out
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: constants.Z_BEST_COMPRESSION })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 画素の輝度（0-255）。カラータイプごとのチャンネル構成を解いてから計算する
 * （grayscale や alpha 付きで隣の画素・alpha を色成分として読むと字形が変わる）。
 * alpha は黒背景へ合成する（ゲーム画面は黒地の UI）。
 */
export function luminanceAt(image: DecodedImage, x: number, y: number): number {
  const s = (y * image.width + x) * image.channels
  const d = image.data
  const gray = image.channels <= 2
  const r = d[s] ?? 0
  const g = gray ? r : (d[s + 1] ?? 0)
  const b = gray ? r : (d[s + 2] ?? 0)
  const alpha =
    image.channels === 2 || image.channels === 4 ? (d[s + image.channels - 1] ?? 0) : 255
  return ((0.299 * r + 0.587 * g + 0.114 * b) * alpha) / 255
}
