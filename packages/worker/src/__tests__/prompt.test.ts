// プロンプトと契約（shared 抽出スキーマ → 正規レコード検証）の乖離検知（prd/04 §9.3）。
// EXAMPLE を実際の下流（フラット変換 → shared 検証）に通し、契約変更で fail させる。

import { extractionToFlatRecord, ScreenshotExtractionSchema, validateRunRecord } from 'shared'
import { describe, expect, it } from 'vitest'
import { buildExtractionPrompt, EXAMPLE_EXTRACTION } from '../prompt'

describe('buildExtractionPrompt', () => {
  it('画像の index とファイルパスを列挙する', () => {
    const prompt = buildExtractionPrompt([{ path: '/tmp/a.png' }, { path: '/tmp/b.jpg' }])
    expect(prompt).toContain('2 枚')
    expect(prompt).toContain('0: /tmp/a.png')
    expect(prompt).toContain('1: /tmp/b.jpg')
  })

  it('ドメインの落とし穴ルール（リロール・points・複数列レイアウト・null）を含む', () => {
    const prompt = buildExtractionPrompt([{ path: '/tmp/a.png' }])
    expect(prompt).toContain('reroll')
    expect(prompt).toContain('count（○×）とは掛けない')
    expect(prompt).toContain('複数列レイアウト')
    expect(prompt).toContain('憶測せず null')
  })

  // 列数を決め打つと、3 列以上のレイアウトで列跨ぎの続きが前の週へ吸い込まれる
  // （実測: WEEK 5 の 11 行が丸ごと WEEK 4 に混入）。列数を仮定しないことを固定する。
  it('列画像が無いときは列数を決め打たず、列跨ぎの継続を明示する', () => {
    const prompt = buildExtractionPrompt([{ path: '/tmp/a.png' }])
    expect(prompt).not.toContain('2列レイアウト')
    expect(prompt).toContain('2 列とは限らず 3 列以上のこともある')
    expect(prompt).toContain('列の先頭に WEEK 見出しが無ければ')
  })

  describe('列画像を併送するとき', () => {
    const prompt = buildExtractionPrompt([
      { path: '/tmp/result.png' },
      { path: '/tmp/history.png' },
      { path: '/tmp/history-col-1.png', derived: { sourceIndex: 1, column: 1 } },
      { path: '/tmp/history-col-2.png', derived: { sourceIndex: 1, column: 2 } },
    ])

    it('枚数は元画像だけで数え、列画像には由来を注記する', () => {
      expect(prompt).toContain('2 枚')
      expect(prompt).toContain('index 0〜3')
      expect(prompt).toContain('2: /tmp/history-col-1.png   ← index 1 の左から 1 列目（拡大）')
      expect(prompt).toContain('3: /tmp/history-col-2.png   ← index 1 の左から 2 列目（拡大）')
    })

    // images の index は run_image を引き直す鍵（prd/04 §9.1）。列画像に分類を振らせると
    // 元画像の section が埋まらないまま「範囲外の index」として捨てられる。
    it('分類は元画像だけに限定させる', () => {
      expect(prompt).toContain('元のスクショ（index 0〜1）だけの分類を入れる')
    })

    it('行は列画像から読ませ、列画像を跨ぐ継続を明示する', () => {
      expect(prompt).toContain('行はこの列画像から読む')
      expect(prompt).toContain('列画像の先頭に WEEK 見出しが無ければ')
      expect(prompt).toContain('どの列画像も丸ごと落としていないか')
      // 1 枚の中で列を辿るルールは列画像があるときは要らない（読み順は画像の並びで決まる）
      expect(prompt).not.toContain('まず列が何本あるか数える')
    })
  })
})

describe('EXAMPLE_EXTRACTION（乖離検知）', () => {
  it('抽出スキーマに適合する', () => {
    expect(ScreenshotExtractionSchema.safeParse(EXAMPLE_EXTRACTION).success).toBe(true)
  })

  it('フラット変換後、正規レコードとして error/warning なしで検証を通る（自己整合）', () => {
    const extraction = ScreenshotExtractionSchema.parse(EXAMPLE_EXTRACTION)
    const flat = extractionToFlatRecord(extraction)
    // order_in_week の採番は server の ingestion アダプタの仕事。ここでは同じ規約
    // （週ごとの連番）を適用して下流検証まで通す。
    const counters = new Map<number, number>()
    const history = (flat.upgrade_history as Record<string, unknown>[]).map((e) => {
      const week = e.week as number
      const next = (counters.get(week) ?? 0) + 1
      counters.set(week, next)
      const { week: _, type, ...rest } = e
      return { ...rest, week_index: week, order_in_week: next, entry_type: type }
    })
    const result = validateRunRecord({ ...flat, upgrade_history: history })
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([]) // Σpoints = apocalypse_bonus で warning も無い
  })
})
