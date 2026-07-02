// 記述分析（MVP。prd/06）。server の集計エンドポイント（/api/analysis/summary）を1回叩くだけ
// （run 詳細の N+1 取得を排除）。スコア推移（played_at 軸）・アップグレード取得頻度・
// 選択アップグレードの取得タイミング（何手目・何週）分布を Recharts で可視化する。集計キーは catalog ID。

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { client } from '../api'
import { useAuth } from '../lib/auth'

interface Summary {
  stats: { count: number; best: number; avg: number }
  scoreTrend: { playedAt: string; finalScore: number | null }[]
  frequency: { catalogId: string | null; name: string | null; count: number }[]
  weekByCatalog: { catalogId: string | null; week: number; count: number }[]
  orderByCatalog: { catalogId: string | null; order: number | null; count: number }[]
}

export function Analysis() {
  const { clearSession } = useAuth()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      const res = await client.api.analysis.summary.$get()
      if (res.status === 401) {
        clearSession()
        return
      }
      if (!res.ok) {
        setError('分析データの取得に失敗しました')
        setLoading(false)
        return
      }
      setSummary((await res.json()) as Summary)
      setLoading(false)
    })()
  }, [clearSession])

  const scoreTrend = useMemo(
    () =>
      (summary?.scoreTrend ?? [])
        .filter((d) => d.finalScore != null)
        .map((d) => ({ t: new Date(d.playedAt).getTime(), score: d.finalScore as number })),
    [summary],
  )

  const frequency = summary?.frequency ?? []
  const selectedId = selected ?? frequency[0]?.catalogId ?? null
  const selectedName = frequency.find((u) => u.catalogId === selectedId)?.name ?? ''

  const orderDist = useMemo(
    () =>
      (summary?.orderByCatalog ?? [])
        .filter((d) => d.catalogId === selectedId && d.order != null)
        .map((d) => ({ order: `${d.order}手目`, orderNum: d.order as number, count: d.count }))
        .sort((a, b) => a.orderNum - b.orderNum),
    [summary, selectedId],
  )

  const weekDist = useMemo(
    () =>
      (summary?.weekByCatalog ?? [])
        .filter((d) => d.catalogId === selectedId)
        .map((d) => ({ week: `WEEK ${d.week}`, weekNum: d.week, count: d.count }))
        .sort((a, b) => a.weekNum - b.weekNum),
    [summary, selectedId],
  )

  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (error) return <p className="text-red-400 text-sm">{error}</p>
  if (!summary || summary.stats.count === 0)
    return (
      <p className="text-slate-400 text-sm">
        確定済みのランがまだありません。インポートで確定保存すると分析できます。
      </p>
    )

  return (
    <div className="space-y-8">
      <h1 className="font-bold text-white text-xl">分析</h1>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="確定ラン数" value={summary.stats.count.toLocaleString()} />
        <Stat label="ベストスコア" value={summary.stats.best.toLocaleString()} />
        <Stat label="平均スコア" value={summary.stats.avg.toLocaleString()} />
      </div>

      <ChartCard title="スコア推移（プレイ日時）">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={scoreTrend} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              stroke="#94a3b8"
              fontSize={11}
              tickFormatter={fmtDate}
            />
            <YAxis stroke="#94a3b8" fontSize={12} width={64} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => fmtDate(Number(v))} />
            <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

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
            <Bar dataKey="count" fill="#34d399" radius={[0, 4, 4, 0]} />
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
          <Bar dataKey="count" fill={fill} radius={[4, 4, 0, 0]} />
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

function fmtDate(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
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
