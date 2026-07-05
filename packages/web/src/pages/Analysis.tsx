// 記述分析（MVP。prd/06）。server の集計エンドポイント（/api/analysis/summary）を1回叩くだけ
// （run 詳細の N+1 取得を排除）。
//   - スコアはランダム性があり run も 1日1回ではないため、折れ線でなく散布図で表示する。
//   - 横軸は「実時間」⇄「順番（run を等間隔に詰める）」を切り替え可能（日が空くと
//     不自然に横長になる問題への対処。散布図・ドットマトリクス共通）。
//   - アップグレード取得タイムライン（2モード。既定は系統構成）:
//     - 系統構成: run ごとのカードに週×系統の取得数を積み上げ棒で表示。
//       並び順を時系列 ⇄ スコア順で切替（スコア要因の分析には日付軸が不要という要件。
//       スコア順に並べ、構成の勾配を目視で掴む）。
//       カードは縦1列（上→下の一本道 = 読み順が一意。グリッドだと行/列どちらに読むか迷う）。
//       左端アクセントの色 = スコア低→高（暗→明の indigo 単一 hue ランプ。散布図の
//       スコア色と同系統。dataviz ordinal validator で dark surface に対し PASS）。
//     - アップグレード別: y=カタログ名 × x=run のドットマトリクス。色 = 系統（週はツールチップ）。

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import {
  UPGRADE_SERIES_KEYS,
  UPGRADE_SERIES_LABELS,
  type UpgradeSeries,
  upgradeSeriesOf,
} from 'shared'
import { client } from '../api'
import { useAuth } from '../lib/auth'

interface TimelineRunMeta {
  runId: string
  playedAt: string
  finalScore: number | null
}
interface TimelineRow {
  runId: string
  catalogId: string | null
  name: string | null
  week: number
}
interface TimelinePoint {
  x: number
  y: number
  label: string
  /** 同一 run 内の同名取得を集約した回数と週リスト（重なり点を作らない）。 */
  count: number
  weeks: number[]
  playedAt: string
}
interface Summary {
  stats: { count: number; best: number; avg: number }
  scoreTrend: { playedAt: string; finalScore: number | null }[]
  frequency: { catalogId: string | null; name: string | null; count: number }[]
  timelineRuns: TimelineRunMeta[]
  timeline: TimelineRow[]
  timelineRunLimit: number
}

/** 横軸モード。time=実時間 / seq=run を等間隔に詰める。 */
type AxisMode = 'time' | 'seq'
/** タイムラインの表示モード。composition=系統構成（既定） / name=アップグレード別。 */
type TimelineMode = 'composition' | 'name'
/** 系統構成カードの並び順。time=時系列 / score=スコア降順。 */
type CompositionSort = 'time' | 'score'

/**
 * 系統カテゴリ配色（ユーザー指定: 主砲=緑 / 核=黄 / シールド=青 / フレイル=紫 / 自動防衛=赤）。
 * dataviz validator（dark surface）で明度帯域・彩度・CVD 分離・コントラスト全て PASS。
 * opportunity / unknown は配色保留のため**意図的に無彩色**（積み上げ・凡例では末尾に置く）。
 */
const SERIES_COLORS: Record<UpgradeSeries, string> = {
  railgun: '#059669',
  nuke: '#d97706',
  shield: '#0284c7',
  flail: '#a855f7',
  automation: '#ef4444',
  opportunity: '#94a3b8',
  unknown: '#64748b',
}

/** スコアの基準色。散布図の点とランプ中央で共用し、両者の同系統性をコードで担保する。 */
const SCORE_COLOR = '#818cf8'
/**
 * スコアの sequential ランプ（低→高 = 暗→明、indigo 単一 hue）。
 * min-max を5段に量子化してカード左端のアクセントに使う。散布図のスコア点（SCORE_COLOR）と
 * 同系統に揃え、系統カテゴリ色とは役割・位置（アクセント bar vs 積み上げ棒）で分離する。
 */
const SCORE_RAMP = ['#4338ca', '#6366f1', SCORE_COLOR, '#a5b4fc', '#c7d2fe'] as const
/** スコア不明（null）run はアクセント無し（どの色でもランプの位置として誤読されるため）。 */
const SCORE_UNKNOWN_COLOR = 'transparent'

export function Analysis() {
  const { clearSession } = useAuth()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [axisMode, setAxisMode] = useState<AxisMode>('time')
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('composition')
  const [compositionSort, setCompositionSort] = useState<CompositionSort>('time')

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await client.api.analysis.summary.$get()
        if (res.status === 401) {
          clearSession()
          return
        }
        if (!res.ok) {
          setError('分析データの取得に失敗しました')
          return
        }
        setSummary((await res.json()) as Summary)
      } catch {
        setError('分析データの取得に失敗しました。時間をおいて再読み込みしてください。')
      } finally {
        setLoading(false)
      }
    })()
  }, [clearSession])

  const scorePoints = useMemo(
    () =>
      (summary?.scoreTrend ?? [])
        .filter((d) => d.finalScore != null)
        .map((d, i) => ({
          seq: i,
          t: new Date(d.playedAt).getTime(),
          score: d.finalScore as number,
          playedAt: d.playedAt,
        })),
    [summary],
  )

  // タイムライン: run メタ（played_at 昇順・等間隔用 index 付き）。
  // エントリ起点でなく run メタ起点にする（取得ゼロ/リロールのみの run も軸・カードに出す）。
  const timelineRuns = useMemo(() => {
    const map = new Map<
      string,
      { seq: number; t: number; playedAt: string; finalScore: number | null }
    >()
    for (const r of summary?.timelineRuns ?? []) {
      map.set(r.runId, {
        seq: map.size,
        t: new Date(r.playedAt).getTime(),
        playedAt: r.playedAt,
        finalScore: r.finalScore,
      })
    }
    return map
  }, [summary])

  const timelineNames = useMemo(() => {
    // 行（カタログ名）は取得頻度の降順（server の frequency はこの行順のためにある）。
    const inTimeline = new Set(
      (summary?.timeline ?? []).map((r) => r.name).filter((n): n is string => n != null),
    )
    return (summary?.frequency ?? [])
      .map((f) => f.name)
      .filter((n): n is string => n != null && inTimeline.has(n))
  }, [summary])

  // アップグレード別ドットマトリクス: 系統ごとの点列（色 = 系統。y は数値インデックス =
  // 頻度降順の行順を強制するため。category 軸はデータ出現順になってしまう）。
  // 同一 run 内の同名取得は1点に集約（完全に重なった点は判別不能になるため。
  // 回数は点サイズ + ツールチップ、取得週はツールチップに全列挙）。
  const matrixBySeries = useMemo(() => {
    const nameIndex = new Map(timelineNames.map((n, i) => [n, i]))
    const agg = new Map<string, TimelinePoint>()
    for (const row of summary?.timeline ?? []) {
      if (row.name == null) continue
      const runPos = timelineRuns.get(row.runId)
      const y = nameIndex.get(row.name)
      if (!runPos || y == null) continue
      const key = `${row.runId}|${row.name}`
      const found = agg.get(key)
      if (found) {
        found.count += 1
        found.weeks.push(row.week)
      } else {
        agg.set(key, {
          x: axisMode === 'time' ? runPos.t : runPos.seq,
          y,
          label: row.name,
          count: 1,
          weeks: [row.week],
          playedAt: runPos.playedAt,
        })
      }
    }
    const buckets = new Map<UpgradeSeries, TimelinePoint[]>()
    for (const p of agg.values()) {
      const series = upgradeSeriesOf(p.label)
      const list = buckets.get(series) ?? []
      list.push(p)
      buckets.set(series, list)
    }
    return UPGRADE_SERIES_KEYS.filter((k) => buckets.has(k)).map(
      (k) => [k, buckets.get(k) as TimelinePoint[]] as const,
    )
  }, [summary, timelineRuns, timelineNames, axisMode])

  // 系統構成カード: run メタ起点（取得ゼロ run も空カードで出す）に、
  // 実在する week_index をそのまま週×系統で集計する（W5+ への畳み込みはしない —
  // 長期 run の取得タイミングが失われるため）。週軸は W1〜全 run の最大週にゼロ埋めして揃える
  // （同じ週がカード間で同じ横位置に来ないと、縦に並べた構成比較が成立しないため。
  // 起点をデータ最小週でなく W1 に固定するのは「W1 で何も取らなかった」と
  // 「W1 が存在しない」の混同を避けるため）。yMax は全カード共通の Y 上限
  // （カードごとの auto domain だと同じ取得数が別の高さに描かれ、積み上げ高さの比較が壊れる）。
  const composition = useMemo(() => {
    const present = new Set<UpgradeSeries>()
    const weeksByRun = new Map<string, Map<number, Partial<Record<UpgradeSeries, number>>>>()
    let minWeek = 1
    let maxWeek = Number.NEGATIVE_INFINITY
    for (const row of summary?.timeline ?? []) {
      if (row.name == null || !timelineRuns.has(row.runId)) continue
      const series = upgradeSeriesOf(row.name)
      present.add(series)
      const weeks = weeksByRun.get(row.runId) ?? new Map()
      const counts = weeks.get(row.week) ?? {}
      counts[series] = (counts[series] ?? 0) + 1
      weeks.set(row.week, counts)
      weeksByRun.set(row.runId, weeks)
      minWeek = Math.min(minWeek, row.week)
      maxWeek = Math.max(maxWeek, row.week)
    }
    const seriesPresent = UPGRADE_SERIES_KEYS.filter((k) => present.has(k))
    const weekRange = Number.isFinite(maxWeek)
      ? Array.from({ length: maxWeek - minWeek + 1 }, (_, i) => minWeek + i)
      : []
    let yMax = 1
    for (const weeks of weeksByRun.values()) {
      for (const counts of weeks.values()) {
        const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0)
        yMax = Math.max(yMax, total)
      }
    }
    const cards = [...timelineRuns.entries()].map(([runId, meta]) => ({
      runId,
      playedAt: meta.playedAt,
      t: meta.t,
      finalScore: meta.finalScore,
      weeks: weekRange.map((week) => {
        const counts = weeksByRun.get(runId)?.get(week) ?? {}
        const rec: Record<string, number | string> = { w: `W${week}` }
        for (const k of seriesPresent) rec[k] = counts[k] ?? 0
        return rec
      }),
    }))
    return { seriesPresent, cards, yMax }
  }, [summary, timelineRuns])

  const compositionCards = useMemo(() => {
    const cards = [...composition.cards]
    if (compositionSort === 'time') return cards.sort((a, b) => a.t - b.t)
    return cards.sort((a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1))
  }, [composition, compositionSort])

  // スコア → ランプ色（表示中 run の min-max を SCORE_RAMP.length 段に量子化）。
  const scoreColor = useMemo(() => {
    const scores = composition.cards.map((c) => c.finalScore).filter((s): s is number => s != null)
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    return (score: number | null): string => {
      if (score == null) return SCORE_UNKNOWN_COLOR
      // 全スコア同値（run 1件を含む）は高低の根拠が無いので中央の基準色にする。
      if (max === min) return SCORE_COLOR
      const idx = Math.min(
        SCORE_RAMP.length - 1,
        Math.floor(((score - min) / (max - min)) * SCORE_RAMP.length),
      )
      return SCORE_RAMP[idx] ?? SCORE_COLOR
    }
  }, [composition])

  const seqTickToDate = useMemo(() => {
    const arr = [...timelineRuns.values()]
    return (seq: number) => {
      const run = arr[Math.round(seq)]
      return run ? fmtDate(run.t) : ''
    }
  }, [timelineRuns])

  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (error) return <p className="text-red-400 text-sm">{error}</p>
  if (!summary || summary.stats.count === 0)
    return (
      <p className="text-slate-400 text-sm">
        確定済みのランがまだありません。インポートで確定保存すると分析できます。
      </p>
    )

  const scoreXProps =
    axisMode === 'time'
      ? ({ dataKey: 't', tickFormatter: fmtDate } as const)
      : ({ dataKey: 'seq', tickFormatter: (v: number) => scoreSeqLabel(scorePoints, v) } as const)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-bold text-white text-xl">分析</h1>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5">
          <ModeToggle
            label="実時間"
            active={axisMode === 'time'}
            onClick={() => setAxisMode('time')}
          />
          <ModeToggle
            label="順番（詰める）"
            active={axisMode === 'seq'}
            onClick={() => setAxisMode('seq')}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="確定ラン数" value={summary.stats.count.toLocaleString()} />
        <Stat label="ベストスコア" value={summary.stats.best.toLocaleString()} />
      </div>

      <ChartCard title="スコア散布図">
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              type="number"
              domain={['auto', 'auto']}
              allowDecimals={false}
              stroke="#94a3b8"
              fontSize={11}
              {...scoreXProps}
            />
            <YAxis dataKey="score" type="number" stroke="#94a3b8" fontSize={12} width={64} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ strokeDasharray: '3 3', stroke: '#475569' }}
              formatter={(v: number) => [v.toLocaleString(), 'スコア']}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload as { playedAt?: string } | undefined
                return p?.playedAt ? fmtDateTime(p.playedAt) : ''
              }}
            />
            <Scatter data={scorePoints} fill={SCORE_COLOR} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartCard>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-200 text-sm">アップグレード取得タイムライン</h2>
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5">
            <ModeToggle
              label="系統構成"
              active={timelineMode === 'composition'}
              onClick={() => setTimelineMode('composition')}
            />
            <ModeToggle
              label="アップグレード別"
              active={timelineMode === 'name'}
              onClick={() => setTimelineMode('name')}
            />
          </div>
        </div>

        {timelineMode === 'name' ? (
          <>
            <p className="text-slate-500 text-xs">
              どのアップグレードを（縦）いつの run で（横）取ったか。色 = 系統（週はツールチップ）。
              表示は直近 {summary.timelineRunLimit} ランまで。
            </p>
            <div className="max-h-[560px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/30 p-2">
              <ResponsiveContainer
                width="100%"
                height={Math.max(240, timelineNames.length * 24 + 80)}
              >
                <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={['auto', 'auto']}
                    allowDecimals={false}
                    stroke="#94a3b8"
                    fontSize={11}
                    tickFormatter={axisMode === 'time' ? fmtDate : seqTickToDate}
                  />
                  <YAxis
                    dataKey="y"
                    type="number"
                    reversed
                    domain={[-0.5, timelineNames.length - 0.5]}
                    ticks={timelineNames.map((_, i) => i)}
                    interval={0}
                    tickFormatter={(i: number) => timelineNames[i] ?? ''}
                    stroke="#94a3b8"
                    fontSize={10}
                    width={190}
                    tick={{ fill: '#cbd5e1' }}
                  />
                  <ZAxis dataKey="count" type="number" range={[50, 200]} />
                  <Tooltip content={<TimelineTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                  <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }} />
                  {matrixBySeries.map(([series, points]) => (
                    <Scatter
                      key={series}
                      name={UPGRADE_SERIES_LABELS[series]}
                      data={points}
                      fill={SERIES_COLORS[series]}
                      isAnimationActive={false}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-slate-500 text-xs">
                run ごとの週×系統の取得数（積み上げ）。上→下の一列で並び、左端の色は
                スコアの低（暗）→高（明）。スコア順に並べて
                「どの週にどの系統を取ると伸びるか」を目視する。分類は攻略ガイド由来の暫定。
                表示は直近 {summary.timelineRunLimit} ランまで。
              </p>
              <div className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5">
                <ModeToggle
                  label="時系列順"
                  active={compositionSort === 'time'}
                  onClick={() => setCompositionSort('time')}
                />
                <ModeToggle
                  label="スコア順"
                  active={compositionSort === 'score'}
                  onClick={() => setCompositionSort('score')}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300 text-xs">
              {composition.seriesPresent.map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: SERIES_COLORS[k] }}
                  />
                  {UPGRADE_SERIES_LABELS[k]}
                </span>
              ))}
            </div>
            <div className="max-h-[640px] space-y-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/30 p-2">
              {compositionCards.map((card) => (
                <div
                  key={card.runId}
                  className="flex items-center gap-3 rounded-lg border border-slate-700/60 border-l-4 bg-slate-800/40 p-2"
                  style={{ borderLeftColor: scoreColor(card.finalScore) }}
                >
                  <div className="w-28 shrink-0">
                    <div className="font-mono text-sm text-white">
                      {card.finalScore?.toLocaleString() ?? '—'}
                    </div>
                    <div className="text-slate-500 text-xs">{fmtDateTime(card.playedAt)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={card.weeks} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#33415577" vertical={false} />
                        <XAxis dataKey="w" stroke="#94a3b8" fontSize={10} tickLine={false} />
                        <YAxis
                          allowDecimals={false}
                          domain={[0, composition.yMax]}
                          stroke="#94a3b8"
                          fontSize={10}
                          width={24}
                        />
                        <Tooltip content={<CompositionTooltip />} cursor={{ fill: '#33415533' }} />
                        {composition.seriesPresent.map((k) => (
                          <Bar
                            key={k}
                            dataKey={k}
                            stackId="s"
                            fill={SERIES_COLORS[k]}
                            stroke="#0f172a"
                            strokeWidth={1}
                            maxBarSize={56}
                            isAnimationActive={false}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function ModeToggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded-md bg-indigo-600 px-3 py-1 font-medium text-white text-xs'
          : 'rounded-md px-3 py-1 text-slate-400 text-xs hover:text-slate-200'
      }
    >
      {label}
    </button>
  )
}

/**
 * 系統構成カードのツールチップ。取得ゼロの週（ゼロ埋め分を含む）では何も出さない —
 * 全系統 0 の列挙は「その週まで生存して何も取らなかった」と誤読させるため。
 */
function CompositionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number | string; color?: string }[]
  label?: string | number
}) {
  const rows = (payload ?? []).filter((p) => typeof p.value === 'number' && p.value > 0)
  if (!active || rows.length === 0) return null
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-sm">
      <div className="text-slate-400 text-xs">{label}</div>
      {rows.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
          {UPGRADE_SERIES_LABELS[p.dataKey as UpgradeSeries] ?? String(p.dataKey)}: {p.value}
        </div>
      ))}
    </div>
  )
}

function TimelineTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload?: TimelinePoint }[]
}) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-sm">
      <div className="font-medium">
        {p.label}
        {p.count > 1 && ` ×${p.count}`}
      </div>
      <div className="text-slate-400 text-xs">
        {p.weeks.map((w) => `WEEK ${w}`).join(', ')} / {fmtDateTime(p.playedAt)}
      </div>
    </div>
  )
}

const TOOLTIP_STYLE = {
  backgroundColor: '#1e293b',
  border: '1px solid #475569',
  borderRadius: 8,
  color: '#e2e8f0',
} as const

function scoreSeqLabel(points: { seq: number; t: number }[], seq: number): string {
  const p = points[Math.round(seq)]
  return p ? fmtDate(p.t) : ''
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-center">
      <div className="font-mono text-white text-xl">{value}</div>
      <div className="text-slate-400 text-xs">{label}</div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-slate-200 text-sm">{title}</h2>
      <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-2">{children}</div>
    </section>
  )
}
