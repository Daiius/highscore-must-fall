// 証拠シート生成の画素変換テスト。
//
// 狙いは1点: **PNG のカラータイプが変わっても同じ字形が出ること**。
// 連続3バイトを無条件に R/G/B として読むと grayscale(1ch) / grayscale+alpha(2ch) では
// 隣の画素や alpha が色成分に混入して字形が変わるが、--verify は同じ変換を通るので
// 画素一致検証では検知できない。証拠シートの前提（文字の形は変えない）が静かに壊れる経路なので、
// 生成画素そのものを静的に押さえる。

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSheet } from '../evidence-sheet.mjs'

// テスト用の最小 PNG エンコーダ（本体は grayscale しか書けないので、ここで各カラータイプを作る）。
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

function chunk(type, payload) {
  const out = Buffer.alloc(8 + payload.length + 4)
  out.writeUInt32BE(payload.length, 0)
  out.write(type, 4, 'ascii')
  payload.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + payload.length)), 8 + payload.length)
  return out
}

/** colorType の PNG を書く。pixels は1画素あたり channels バイトのフラット配列。 */
function writePng(file, width, height, colorType, pixels) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  const stride = width * channels
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    Buffer.from(pixels.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

const WIDTH = 4
const HEIGHT = 2
/** 隣の画素が色成分として混入すれば必ず崩れるよう、輝度を隣接で大きく振っておく。 */
const LEVELS = [0, 64, 128, 255, 16, 200, 32, 96]

const sheetOf = (dir, source) =>
  buildSheet(
    {
      width: WIDTH,
      posterize: 1,
      strips: [{ source, rect: [0, 0, WIDTH, HEIGHT] }],
    },
    dir,
  ).sheet

describe('buildSheet の画素変換', () => {
  let dir

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'evidence-sheet-'))
    // 同じ見た目（R=G=B=level, 不透明）を4つのカラータイプで表現する。
    writePng(join(dir, 'gray.png'), WIDTH, HEIGHT, 0, LEVELS)
    writePng(
      join(dir, 'gray-alpha.png'),
      WIDTH,
      HEIGHT,
      4,
      LEVELS.flatMap((v) => [v, 255]),
    )
    writePng(
      join(dir, 'rgb.png'),
      WIDTH,
      HEIGHT,
      2,
      LEVELS.flatMap((v) => [v, v, v]),
    )
    writePng(
      join(dir, 'rgba.png'),
      WIDTH,
      HEIGHT,
      6,
      LEVELS.flatMap((v) => [v, v, v, 255]),
    )
  })

  it('カラータイプが違っても同じ見た目なら同じ画素になる', () => {
    const expected = Buffer.from(LEVELS)
    expect(sheetOf(dir, 'gray.png')).toEqual(expected)
    expect(sheetOf(dir, 'gray-alpha.png')).toEqual(expected)
    expect(sheetOf(dir, 'rgb.png')).toEqual(expected)
    expect(sheetOf(dir, 'rgba.png')).toEqual(expected)
  })

  it('有彩色は輝度の重み付けで畳まれる（グレー成分だけを読んでいない）', () => {
    // 純赤 / 純緑 / 純青 / 白。R=G=B ではないので、重みを使っていなければ一致しない。
    const pixels = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]
    writePng(join(dir, 'colored.png'), 4, 1, 2, pixels)
    const sheet = buildSheet(
      { width: 4, posterize: 1, strips: [{ source: 'colored.png', rect: [0, 0, 4, 1] }] },
      dir,
    ).sheet
    expect([...sheet]).toEqual([76, 150, 29, 255]) // round(0.299/0.587/0.114 * 255)
  })

  it('透過は黒背景へ合成される', () => {
    writePng(join(dir, 'transparent.png'), 2, 1, 6, [255, 255, 255, 0, 255, 255, 255, 128])
    const sheet = buildSheet(
      { width: 2, posterize: 1, strips: [{ source: 'transparent.png', rect: [0, 0, 2, 1] }] },
      dir,
    ).sheet
    expect([...sheet]).toEqual([0, 128])
  })

  it('rect が画像をはみ出したら例外にする（黙って別の画素を切り出さない）', () => {
    expect(() =>
      buildSheet(
        { width: 4, posterize: 1, strips: [{ source: 'rgba.png', rect: [0, 0, 4, 3] }] },
        dir,
      ),
    ).toThrow(/はみ出す/)
  })

  it('帯を複数積むと境界に1px の区切り線が入る', () => {
    const sheet = buildSheet(
      {
        width: WIDTH,
        posterize: 1,
        strips: [
          { source: 'gray.png', rect: [0, 0, WIDTH, HEIGHT] },
          { source: 'rgb.png', rect: [0, 0, WIDTH, HEIGHT] },
        ],
      },
      dir,
    ).sheet
    expect(sheet.length).toBe(WIDTH * (HEIGHT * 2 + 1))
    expect([...sheet.subarray(WIDTH * HEIGHT, WIDTH * HEIGHT + WIDTH)]).toEqual([40, 40, 40, 40])
  })
})
