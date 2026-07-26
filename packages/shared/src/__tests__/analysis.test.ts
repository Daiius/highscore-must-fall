import { describe, expect, it } from 'vitest'
import {
  type AnalysisRunInput,
  buildTrendAnalysis,
  estimateAcquisitionDay,
  LOW_SAMPLE_THRESHOLD,
  withAcquisitionDays,
} from '../analysis'

/** upgrade を n 個持つ週を作る。 */
const week = (weekIndex: number, names: (string | null)[], rerollsAfter: number[] = []) => {
  const entries = names.map((name, i) => ({
    weekIndex,
    orderInWeek: i + 1,
    entryType: 'upgrade' as const,
    name,
  }))
  // rerollsAfter に入れた「週内位置」の直後にリロールを差し込む（位置は詰め直す）。
  const merged: typeof entries = []
  for (const [i, entry] of entries.entries()) {
    merged.push(entry)
    if (rerollsAfter.includes(i + 1)) {
      merged.push({ weekIndex, orderInWeek: 0, entryType: 'reroll' as never, name: null })
    }
  }
  return merged.map((e, i) => ({ ...e, orderInWeek: i + 1 }))
}

const run = (over: Partial<AnalysisRunInput> = {}): AnalysisRunInput => ({
  runId: 'r1',
  finalScore: 100_000,
  daysSurvived: 14,
  nukesLaunched: 7,
  entries: [...week(1, ['ARC FLAIL', 'NUCLEAR WEAPONS LAB']), ...week(2, ['TELEGRAPH BASILISK'])],
  ...over,
})

describe('estimateAcquisitionDay', () => {
  it('完走した週では 7 日を取得順で等分する', () => {
    // W1・4 個取得・28 日生存 → 各持ち分 1.75 日、中央は 0.875 / 2.625 / 4.375 / 6.125
    expect(estimateAcquisitionDay(1, 1, 4, 28)).toBeCloseTo(0.875)
    expect(estimateAcquisitionDay(1, 4, 4, 28)).toBeCloseTo(6.125)
  })

  it('週の途中で死んだ run は、その週に生きた日数で按分する', () => {
    // 5 日で死亡・W1 に 7 個 → 5 日を 7 等分
    expect(estimateAcquisitionDay(1, 1, 7, 5)).toBeCloseTo(5 / 7 / 2)
    expect(estimateAcquisitionDay(1, 7, 7, 5)).toBeCloseTo(5 - 5 / 7 / 2)
  })

  it('週が進むと開始日がずれる', () => {
    expect(estimateAcquisitionDay(3, 1, 2, 21)).toBeCloseTo(14 + 1.75)
  })

  it('upgrade が 0 個の週は週末を返す（0 除算しない）', () => {
    expect(estimateAcquisitionDay(2, 1, 0, 14)).toBe(14)
  })

  it('week が days から見て進みすぎでも落ちない（検出は validate の責務）', () => {
    // days=5 なのに W3 → 本来ありえないが、分析側は例外を投げない
    expect(Number.isFinite(estimateAcquisitionDay(3, 1, 2, 5))).toBe(true)
  })
})

describe('withAcquisitionDays', () => {
  it('リロールは分母に数えず、直後の upgrade と同じ日になる', () => {
    // W1 に upgrade 2 個 + 1 個目の直後にリロール 1 回。14 日生存。
    const dated = withAcquisitionDays(
      run({
        daysSurvived: 7,
        entries: week(1, ['ARC FLAIL', 'NUCLEAR WEAPONS LAB'], [1]),
      }),
    )
    const upgrades = dated.filter((e) => e.entryType === 'upgrade')
    const rerolls = dated.filter((e) => e.entryType === 'reroll')

    // 分母は 2（リロールを含めれば 3 になり 7/3 刻みになるはず）
    expect(upgrades[0]?.day).toBeCloseTo(1.75)
    expect(upgrades[1]?.day).toBeCloseTo(5.25)
    // リロールは「直後の upgrade」＝2 個目と同日
    expect(rerolls[0]?.day).toBeCloseTo(5.25)
  })

  it('末尾のリロール（後続 upgrade なし）は週の終端に置く', () => {
    const dated = withAcquisitionDays(
      run({ daysSurvived: 7, entries: week(1, ['ARC FLAIL'], [1]) }),
    )
    expect(dated.find((e) => e.entryType === 'reroll')?.day).toBe(7)
  })

  it('取得日の昇順で返す', () => {
    const dated = withAcquisitionDays(run())
    const days = dated.map((e) => e.day)
    expect([...days].sort((a, b) => a - b)).toEqual(days)
  })
})

describe('buildTrendAnalysis', () => {
  const runs: AnalysisRunInput[] = [
    run({
      runId: 'long',
      finalScore: 600_000,
      daysSurvived: 28,
      nukesLaunched: 28,
      entries: [
        ...week(1, ['ARC FLAIL', 'TELEGRAPH BASILISK', 'IN-FLIGHT REPAIRS']),
        ...week(2, ['HARDENED SPLINTERS'], [1]),
      ],
    }),
    run({
      runId: 'short',
      finalScore: 50_000,
      daysSurvived: 5,
      nukesLaunched: 0,
      entries: week(1, ['ARC FLAIL', 'NUCLEAR WEAPONS LAB']),
    }),
  ]
  const result = buildTrendAnalysis(runs)

  it('主砲は経路まで割られ、railgun には畳まれない', () => {
    const basilisk = result.branches.find((b) => b.branch === 'basilisk')
    expect(basilisk?.takenRuns).toBe(1)
    expect(basilisk?.points.find((p) => p.runId === 'long')?.count).toBe(2)
  })

  it('取っていない run も点として残る（比較対象を消さない）', () => {
    const basilisk = result.branches.find((b) => b.branch === 'basilisk')
    const short = basilisk?.points.find((p) => p.runId === 'short')
    expect(short).toBeDefined()
    expect(short?.count).toBe(0)
    expect(short?.firstDay).toBeNull()
  })

  it('初出は最も早い取得日になる', () => {
    const basilisk = result.branches.find((b) => b.branch === 'basilisk')
    const long = basilisk?.points.find((p) => p.runId === 'long')
    // W1 の 3 個中 2 番目（28 日生存 → 7/3 刻みの中央）
    expect(long?.firstDay).toBeCloseTo((7 * 1.5) / 3)
  })

  it('OU は系統に畳まず、個別の行になる', () => {
    expect(result.opportunities.map((o) => o.name)).toEqual(['IN-FLIGHT REPAIRS'])
    const ou = result.opportunities[0]
    expect(ou?.takenRuns).toBe(1)
    // 未取得 run も点として残る（day=null → UI の「未取得」列）
    expect(ou?.points.find((p) => p.runId === 'short')?.day).toBeNull()
  })

  it('kind が渡されれば series.ts 未収載でも OU として扱う', () => {
    const withKind = buildTrendAnalysis([
      run({
        runId: 'x',
        entries: [
          {
            weekIndex: 1,
            orderInWeek: 1,
            entryType: 'upgrade',
            name: 'UNKNOWN NEW OU',
            kind: 'opportunity_upgrade',
          },
        ],
      }),
    ])
    expect(withKind.opportunities.map((o) => o.name)).toEqual(['UNKNOWN NEW OU'])
  })

  it('リロールは率で、核は 1 日あたりで返す', () => {
    const long = result.runMetrics.find((m) => m.runId === 'long')
    expect(long?.upgrades).toBe(4)
    expect(long?.rerollRate).toBeCloseTo(1 / 4)
    expect(long?.nukesPerDay).toBeCloseTo(1)
  })

  it('取得ゼロ・生存ゼロでも 0 除算しない', () => {
    const empty = buildTrendAnalysis([
      run({ runId: 'e', daysSurvived: 0, nukesLaunched: 3, entries: [] }),
    ])
    expect(empty.runMetrics[0]?.rerollRate).toBe(0)
    expect(empty.runMetrics[0]?.nukesPerDay).toBe(0)
  })

  it('n 不足は表示用フラグとして返るだけで、点は除外されない', () => {
    const basilisk = result.branches.find((b) => b.branch === 'basilisk')
    expect(basilisk?.lowSample).toBe(true)
    expect(basilisk?.points).toHaveLength(runs.length)
    expect(result.lowSampleThreshold).toBe(LOW_SAMPLE_THRESHOLD)
  })

  it('全 branch が常に返る（取得ゼロでも行が消えない）', () => {
    expect(result.branches).toHaveLength(11)
  })
})
