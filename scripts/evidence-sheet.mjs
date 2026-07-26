#!/usr/bin/env node
// 証拠シート生成器（依存ゼロ / node:zlib + node:crypto のみ）。
//
// 目的: カタログ名の `evidence` に使う一次情報を、フル解像度スクショのコミットではなく
// 「名前が読める帯だけを切り出して連結した1枚」に置き換える（prd/08-catalog-lifecycle.md §3）。
// 実測でフル9枚 10.1MB → シート1枚 132KB（10種分）。
//
// **加工物を証拠にするための2条件**（prd/samples/README.md §5）:
//   1. 変換が決定論的であること   … 手編集の混入余地をゼロにする。--verify で再現検証できる。
//   2. 原本へ遡れること           … manifest に原本のファイル名と sha256 を記録する。
//
// 使い方:
//   node scripts/evidence-sheet.mjs prd/samples/<sheet>.json            # 生成（sha256 未記入なら補う）
//   node scripts/evidence-sheet.mjs prd/samples/<sheet>.json --verify   # 再生成して画素一致を検証
//
// --verify は**ファイルのバイト列でなく画素**を比べる。deflate の出力は zlib の版で変わりうるが、
// 証拠として同一性が要るのは画素だからである。

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { constants, deflateSync, inflateSync } from 'node:zlib'

// ---------------------------------------------------------------- PNG codec

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** PNG を読んで {width, height, channels, data} にする。8bit / 非インタレースのみ。 */
function decodePng(file) {
  const buf = readFileSync(file)
  let offset = 8
  let header = null
  const idat = []
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const body = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    }
    offset += 12 + length
  }
  if (!header) throw new Error(`${file}: IHDR が無い`)
  if (header.depth !== 8 || header.interlace !== 0) {
    throw new Error(`${file}: 8bit 非インタレースのみ対応（depth=${header.depth}）`)
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.color]
  if (!channels) throw new Error(`${file}: 未対応のカラータイプ ${header.color}`)

  const raw = inflateSync(Buffer.concat(idat))
  const { width, height } = header
  const stride = width * channels
  const data = Buffer.alloc(height * stride)
  let read = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[read++]
    const line = raw.subarray(read, read + stride)
    read += stride
    const cur = data.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let value = line[x]
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

/** グレースケール 8bit（カラータイプ 0）で書き出す。 */
function encodeGrayPng(width, height, gray, file) {
  const raw = Buffer.alloc(height * (width + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 2 // Up filter。横に走る UI の罫線と字面によく効く
    for (let x = 0; x < width; x++) {
      const up = y > 0 ? gray[(y - 1) * width + x] : 0
      raw[y * (width + 1) + 1 + x] = (gray[y * width + x] - up) & 0xff
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  const chunk = (type, payload) => {
    const out = Buffer.alloc(8 + payload.length + 4)
    out.writeUInt32BE(payload.length, 0)
    out.write(type, 4, 'ascii')
    payload.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + payload.length)), 8 + payload.length)
    return out
  }
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: constants.Z_BEST_COMPRESSION })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

// ------------------------------------------------------------------ 変換本体

const SEPARATOR = 40 // 帯の境界に引く1px の線の輝度（ゲーム内の文字と紛れない暗さ）

/**
 * manifest から証拠シートの画素を組み立てる。**この関数が決定論の本体**。
 * 同じ原本・同じ manifest なら常に同じ画素になること。
 */
function buildSheet(manifest, rawDir) {
  const { width, posterize } = manifest
  const strips = manifest.strips.map((strip) => {
    const file = join(rawDir, strip.source)
    const bytes = readFileSync(file)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const image = decodePng(file)
    const [x0, y0, w, h] = strip.rect
    if (x0 + w > image.width || y0 + h > image.height) {
      throw new Error(`${strip.source}: rect が画像 ${image.width}x${image.height} をはみ出す`)
    }
    // 切り出し → 輝度化 → 階調を落とす。文字の形は変えない（綴りが証拠の本体なので）。
    const gray = Buffer.alloc(width * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((y0 + y) * image.width + (x0 + x)) * image.channels
        const luma = 0.299 * image.data[s] + 0.587 * image.data[s + 1] + 0.114 * image.data[s + 2]
        const quantized = Math.min(255, Math.round(Math.round(luma) / posterize) * posterize)
        gray[y * width + x] = quantized
      }
    }
    return { sha256, height: h, gray }
  })

  const height = strips.reduce((sum, s) => sum + s.height, 0) + (strips.length - 1)
  const sheet = Buffer.alloc(width * height)
  let y = 0
  for (const [index, strip] of strips.entries()) {
    strip.gray.copy(sheet, y * width)
    y += strip.height
    if (index < strips.length - 1) {
      sheet.fill(SEPARATOR, y * width, (y + 1) * width)
      y += 1
    }
  }
  return { width, height, sheet, sha256s: strips.map((s) => s.sha256) }
}

// -------------------------------------------------------------------- CLI

const [manifestPath, ...flags] = process.argv.slice(2)
if (!manifestPath) {
  console.error('usage: node scripts/evidence-sheet.mjs <manifest.json> [--verify]')
  process.exit(2)
}
const verify = flags.includes('--verify')
const manifestFile = resolve(manifestPath)
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..')
const rawDir = resolve(repoRoot, manifest.rawDir)
const pngFile = join(dirname(manifestFile), `${manifest.sheet}.png`)

const { width, height, sheet, sha256s } = buildSheet(manifest, rawDir)

// 原本の sha256 を突合（未記入なら補って manifest を書き戻す）。
const drift = []
let filled = false
for (const [index, strip] of manifest.strips.entries()) {
  if (!strip.sha256) {
    strip.sha256 = sha256s[index]
    filled = true
  } else if (strip.sha256 !== sha256s[index]) {
    drift.push(
      `${strip.source}: 記録 ${strip.sha256.slice(0, 12)} / 実物 ${sha256s[index].slice(0, 12)}`,
    )
  }
}
if (drift.length > 0) {
  console.error(`[evidence-sheet] 原本の sha256 が一致しない:\n  ${drift.join('\n  ')}`)
  process.exit(1)
}

if (verify) {
  const committed = decodePng(pngFile)
  if (committed.width !== width || committed.height !== height || committed.channels !== 1) {
    console.error(`[evidence-sheet] ${manifest.sheet}: 寸法が違う（再生成が必要）`)
    process.exit(1)
  }
  const differing = committed.data.compare(sheet) !== 0
  if (differing) {
    console.error(`[evidence-sheet] ${manifest.sheet}: 画素が manifest から再現できない`)
    process.exit(1)
  }
  console.log(`[evidence-sheet] ${manifest.sheet}: 原本から再現できた（${width}x${height}）`)
} else {
  encodeGrayPng(width, height, sheet, pngFile)
  if (filled) writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`[evidence-sheet] ${pngFile} を生成（${width}x${height}）`)
}
