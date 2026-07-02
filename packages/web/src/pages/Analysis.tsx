// 記述分析（MVP。prd/06）。confirmed run を集計してスコア推移・アップグレード頻度・
// 取得週分布を Recharts で可視化する。集計は owner の run 詳細をまとめて取得して client 側で行う
// （単一ユーザー・小規模想定。重くなれば server 集計エンドポイントへ移す）。

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

interface RunRow {
  id: string
  playedAt: string
  status: 'draft' | 'confirmed'
  finalScore: number | null
}
interface DetailData {
  finalScore: number | null
  playedAt: string
  upgradeEntries: {
    entryType: 'upgrade' | 'reroll'
    weekIndex: number
    name: string | null
  }[]
}

export function Analysis() {
  const [details, setDetails] = useState<DetailData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const listRes = await client.api.runs.$get({ query: { limit: '200', offset: '0' } })
      const { runs } = (await listRes.json()) as { runs: RunRow[] }
      const confirmed = runs.filter((r) => r.status === 'confirmed')
      const fetched = await Promise.all(
        confirmed.map(async (r) => {
          const res = await client.api.runs[':id'].$get({ param: { id: r.id } })
          return res.ok ? ((await res.json()) as DetailData) : null
        }),
      )
      setDetails(fetched.filter((d): d is DetailData => d !== null))
      setLoading(false)
    })()
  }, [])

  const scoreTrend = useMemo(
    () =>
      [...details]
        .filter((d) => d.finalScore != null)
        .sort((a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime())
        .map((d, i) => ({ n: i + 1, score: d.finalScore as number })),
    [details],
  )

  const upgradeFreq = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of details) {
      for (const e of d.upgradeEntries) {
        if (e.entryType === 'upgrade' && e.name) counts.set(e.name, (counts.get(e.name) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
  }, [details])

  const weekDist = useMemo(() => {
    const counts = new Map<number, number>()
    for (const d of details) {
      for (const e of d.upgradeEntries) {
        if (e.entryType === 'upgrade') counts.set(e.weekIndex, (counts.get(e.weekIndex) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([week, count]) => ({ week: `WEEK ${week}`, count }))
      .sort((a, b) => a.week.localeCompare(b.week))
  }, [details])

  const stats = useMemo(() => {
    const scores = details.map((d) => d.finalScore).filter((s): s is number => s != null)
    if (scores.length === 0) return null
    return {
      count: scores.length,
      best: Math.max(...scores),
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }
  }, [details])

  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (details.length === 0)
    return (
      <p className="text-slate-400 text-sm">
        確定済みのランがまだありません。インポートで確定保存すると分析できます。
      </p>
    )

  return (
    <div className="space-y-8">
      <h1 className="font-bold text-white text-xl">分析</h1>

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="確定ラン数" value={stats.count.toLocaleString()} />
          <Stat label="ベストスコア" value={stats.best.toLocaleString()} />
          <Stat label="平均スコア" value={stats.avg.toLocaleString()} />
        </div>
      )}

      <ChartCard title="スコア推移（古い順）">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={scoreTrend} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="n" stroke="#94a3b8" fontSize={12} />
            <YAxis stroke="#94a3b8" fontSize={12} width={64} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="アップグレード取得頻度（上位15）">
        <ResponsiveContainer width="100%" height={Math.max(240, upgradeFreq.length * 26)}>
          <BarChart
            data={upgradeFreq}
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

      <ChartCard title="取得タイミング分布（週ごとのアップグレード数）">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={weekDist} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="week" stroke="#94a3b8" fontSize={12} />
            <YAxis stroke="#94a3b8" fontSize={12} width={48} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#33415533' }} />
            <Bar dataKey="count" fill="#fbbf24" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}

const TOOLTIP_STYLE = {
  backgroundColor: '#1e293b',
  border: '1px solid #475569',
  borderRadius: 8,
  color: '#e2e8f0',
} as const

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
