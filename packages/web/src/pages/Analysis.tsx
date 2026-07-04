// 記述分析（MVP。prd/06）。server の集計エンドポイント（/api/analysis/summary）を1回叩くだけ
// （run 詳細の N+1 取得を排除）。
//   - スコアはランダム性があり run も 1日1回ではないため、折れ線でなく散布図で表示する。
//   - 横軸は「実時間」⇄「順番（run を等間隔に詰める）」を切り替え可能（日が空くと
//     不自然に横長になる問題への対処。散布図・ドットマトリクス共通）。
//   - アップグレード取得タイムライン（2モード）:
//     - アップグレード別: y=カタログ名 × x=run のドットマトリクス。色 = 系統（週はツールチップ）。
//     - 系統構成（実験）: run ごとのカードに週×系統の取得数を積み上げ棒で表示。
//       並び順を時系列 ⇄ スコア順で切替（スコア要因の分析には日付軸が不要という要件。
//       スコア順に並べ、構成の勾配を目視で掴む）。
//   - 取得頻度・タイミング分布は検討のため温存（頻度はほぼ全部1で意味が薄い認識）。

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
  weekByCatalog: { catalogId: string | null; week: number; count: number }[]
  orderByCatalog: { catalogId: string | null; order: number | null; count: number }[]
  timelineRuns: TimelineRunMeta[]
  timeline: TimelineRow[]
  timelineRunLimit: number
}

/** 横軸モード。time=実時間 / seq=run を等間隔に詰める。 */
type AxisMode = 'time' | 'seq'
/** タイムラインの表示モード。name=アップグレード別 / composition=系統構成（実験）。 */
type TimelineMode = 'name' | 'composition'
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

export function Analysis() {
  const { clearSession } = useAuth()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [axisMode, setAxisMode] = useState<AxisMode>('time')
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('name')
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
    // 行（カタログ名）は取得頻度の降順 = 頻度グラフと同じ並びで馴染ませる。
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
  // 長期 run の取得タイミングが失われるため。カード内の棒本数は週数に応じて可変）。
  const composition = useMemo(() => {
    const present = new Set<UpgradeSeries>()
    const weeksByRun = new Map<string, Map<number, Partial<Record<UpgradeSeries, number>>>>()
    for (const row of summary?.timeline ?? []) {
      if (row.name == null || !timelineRuns.has(row.runId)) continue
      const series = upgradeSeriesOf(row.name)
      present.add(series)
      const weeks = weeksByRun.get(row.runId) ?? new Map()
      const counts = weeks.get(row.week) ?? {}
      counts[series] = (counts[series] ?? 0) + 1
      weeks.set(row.week, counts)
      weeksByRun.set(row.runId, weeks)
    }
    const seriesPresent = UPGRADE_SERIES_KEYS.filter((k) => present.has(k))
    const cards = [...timelineRuns.entries()].map(([runId, meta]) => ({
      runId,
      playedAt: meta.playedAt,
      t: meta.t,
      finalScore: meta.finalScore,
      weeks: [...(weeksByRun.get(runId) ?? new Map()).entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([week, counts]) => {
          const rec: Record<string, number | string> = { w: `W${week}` }
          for (const k of seriesPresent) rec[k] = counts[k] ?? 0
          return rec
        }),
    }))
    return { seriesPresent, cards }
  }, [summary, timelineRuns])

  const compositionCards = useMemo(() => {
    const cards = [...composition.cards]
    if (compositionSort === 'time') return cards.sort((a, b) => a.t - b.t)
    return cards.sort((a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1))
  }, [composition, compositionSort])

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

  const frequency = summary.frequency
  const selectedId = selected ?? frequency[0]?.catalogId ?? null
  const selectedName = frequency.find((u) => u.catalogId === selectedId)?.name ?? ''
  const orderDist = summary.orderByCatalog
    .filter((d) => d.catalogId === selectedId && d.order != null)
    .map((d) => ({ order: `${d.order}手目`, orderNum: d.order as number, count: d.count }))
    .sort((a, b) => a.orderNum - b.orderNum)
  const weekDist = summary.weekByCatalog
    .filter((d) => d.catalogId === selectedId)
    .map((d) => ({ week: `WEEK ${d.week}`, weekNum: d.week, count: d.count }))
    .sort((a, b) => a.weekNum - b.weekNum)

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
            <Scatter data={scorePoints} fill="#818cf8" isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartCard>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-200 text-sm">アップグレード取得タイムライン</h2>
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5">
            <ModeToggle
              label="アップグレード別"
              active={timelineMode === 'name'}
              onClick={() => setTimelineMode('name')}
            />
            <ModeToggle
              label="系統構成（実験）"
              active={timelineMode === 'composition'}
              onClick={() => setTimelineMode('composition')}
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
                run ごとの週×系統の取得数（積み上げ）。スコア順に並べて
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {compositionCards.map((card) => (
                <div
                  key={card.runId}
                  className="rounded-lg border border-slate-700 bg-slate-800/30 p-3"
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm text-white">
                      {card.finalScore?.toLocaleString() ?? '—'}
                    </span>
                    <span className="text-slate-500 text-xs">{fmtDateTime(card.playedAt)}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={card.weeks} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#33415577" vertical={false} />
                      <XAxis dataKey="w" stroke="#94a3b8" fontSize={10} tickLine={false} />
                      <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={10} width={24} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        cursor={{ fill: '#33415533' }}
                        formatter={(v: number, key: string) => [
                          v,
                          UPGRADE_SERIES_LABELS[key as UpgradeSeries] ?? key,
                        ]}
                      />
                      {composition.seriesPresent.map((k) => (
                        <Bar
                          key={k}
                          dataKey={k}
                          stackId="s"
                          fill={SERIES_COLORS[k]}
                          stroke="#0f172a"
                          strokeWidth={1}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <ChartCard title="アップグレード取得頻度（上位15）">
        <ResponsiveContainer
          width="100%"
          height={Math.max(240, Math.min(frequency.length, 15) * 26)}
        >
          <BarChart
            data={frequency.slice(0, 15)}
            layout="vertical"
            margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis type="number" stroke="#94a3b8" fontSize={12} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#94a3b8"
              fontSize={11}
              width={180}
              tick={{ fill: '#cbd5e1' }}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#33415533' }} />
            <Bar dataKey="count" fill="#34d399" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-slate-200 text-sm">取得タイミング分布</h2>
          <select
            value={selectedId ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200 text-sm"
          >
            {frequency.map((u) => (
              <option key={u.catalogId ?? ''} value={u.catalogId ?? ''}>
                {u.name}（{u.count}）
              </option>
            ))}
          </select>
        </div>
        <p className="text-slate-500 text-xs">
          「{selectedName}」が全体で何手目・何週に取られたかの分布（catalog ID で集計）。
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <TimingChart data={orderDist} dataKey="order" fill="#fbbf24" caption="取得順（何手目）" />
          <TimingChart data={weekDist} dataKey="week" fill="#38bdf8" caption="取得週" />
        </div>
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

function TimingChart({
  data,
  dataKey,
  fill,
  caption,
}: {
  data: { count: number }[]
  dataKey: string
  fill: string
  caption: string
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-2">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey={dataKey} stroke="#94a3b8" fontSize={11} />
          <YAxis stroke="#94a3b8" fontSize={12} width={40} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#33415533' }} />
          <Bar dataKey="count" fill={fill} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p className="pb-1 text-center text-slate-500 text-xs">{caption}</p>
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
