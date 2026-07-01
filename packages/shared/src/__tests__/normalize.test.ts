import { describe, expect, it } from 'vitest'
import { namesMatch, normalizeName } from '../normalize'

const NUL = String.fromCharCode(0) // 非空白の制御文字（テスト用）

describe('normalizeName', () => {
  it('大文字化・トリム・連続空白の畳み込みをする', () => {
    expect(normalizeName('  chef’s   kiss ')).toBe("CHEF'S KISS")
  })

  it('tab / 改行 / NBSP 等の空白系も単一スペースへ畳む', () => {
    expect(normalizeName('NO\tESCAPE\nNOW PLEASE')).toBe('NO ESCAPE NOW PLEASE')
  })

  it('印刷用の引用符・ダッシュを ASCII 等価へ寄せる', () => {
    expect(normalizeName('“chef’s” – kiss')).toBe('"CHEF\'S" - KISS')
  })

  it('全角英数を半角へ（NFKC）', () => {
    expect(normalizeName('ＡＢＣ')).toBe('ABC')
  })

  it('アクセント（ダイアクリティカルマーク）を除去する', () => {
    expect(normalizeName('café naïve')).toBe('CAFE NAIVE')
  })

  it('非空白の制御文字を除去する', () => {
    expect(normalizeName(`A${NUL}BC`)).toBe('ABC')
  })

  it('ASCII 記号（apostrophe ! ? & . -）は保持する', () => {
    expect(normalizeName('gonna & have! me? some. fun-now')).toBe('GONNA & HAVE! ME? SOME. FUN-NOW')
  })

  it('OCR homoglyph（O↔0）は畳み込まない', () => {
    expect(normalizeName('c0balt coil gun')).toBe('C0BALT COIL GUN')
    expect(namesMatch('cobalt coil gun', 'c0balt coil gun')).toBe(false)
  })

  it('べき等（正規形を再度通しても不変）', () => {
    const once = normalizeName(' Deploy  Laser – Watchtower ')
    expect(normalizeName(once)).toBe(once)
  })
})

describe('namesMatch', () => {
  it('大小・空白・引用符の揺れを跨いで一致する', () => {
    expect(namesMatch('  chef’s kiss', "CHEF'S KISS ")).toBe(true)
  })

  it('別名は一致しない', () => {
    expect(namesMatch('ARC FLAIL', 'EXTENDED FLAIL')).toBe(false)
  })
})
