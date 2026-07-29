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

/**
 * PNG（8bit・非インタレース）をデコードする。対応外の形式は throw する
 * （呼び出し側は列分割を諦めて元画像のまま進む）。
 */
export function decodePng(bytes: Buffer): DecodedImage {
  let offset = 8
  let header: {
    width: number
    height: number
    depth: number
    color: number
    interlace: number
  } | null = null
  const idat: Buffer[] = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8] ?? 0,
        color: body[9] ?? 0,
        interlace: body[12] ?? 0,
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    }
    offset += 12 + length
  }
  if (!header) throw new Error('PNG: IHDR が無い')
  if (header.depth !== 8 || header.interlace !== 0) {
    throw new Error(`PNG: 8bit 非インタレースのみ対応（depth=${header.depth}）`)
  }
  const channels = CHANNELS_BY_COLOR_TYPE[header.color]
  if (!channels) throw new Error(`PNG: 未対応のカラータイプ ${header.color}`)

  const raw = inflateSync(Buffer.concat(idat))
  const { width, height } = header
  const stride = width * channels
  const data = Buffer.alloc(height * stride)
  let read = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[read++] ?? 0
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
