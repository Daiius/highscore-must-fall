// 記述分析（MVP。prd/06）。confirmed run を全件集計してスコア推移・アップグレード取得頻度・
// 選択したアップグレードの取得タイミング（何手目・何週）分布を Recharts で可視化する。
// 集計キーは表示名でなく安定した catalog ID を使う。集計は client 側（単一ユーザー・小規模想定。
// 重くなれば server 集計エンドポイントへ移す）。一覧は total まで全ページ取得し、黙って打ち切らない。

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

interface RunRow {
  id: string
  status: 'draft' | 'confirmed'
}
interface UpgradeEntry {
  entryType: 'upgrade' | 'reroll'
  weekIndex: number
  upgradeOrder: number | null
  catalogId: string | null
  name: string | null
}
interface DetailData {
  finalScore: number | null
  playedAt: string
  upgradeEntries: UpgradeEntry[]
}

const LIST_PAGE = 200

export function Analysis() {
  const { clearSession } = useAuth()
  const [details, setDetails] = useState<DetailData[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      // confirmed run の id を total まで全ページ取得（黙って打ち切らない）。
      const ids: string[] = []
      let offset = 0
      let total = Number.POSITIVE_INFINITY
      while (offset < total) {
        const res = await client.api.runs.$get({
          query: { limit: String(LIST_PAGE), offset: String(offset) },
        })
        if (res.status === 401) {
          clearSession()
          return
        }
        const data = (await res.json()) as { runs: RunRow[]; total: number }
        total = data.total
        for (const r of data.runs) if (r.status === 'confirmed') ids.push(r.id)
        if (data.runs.length === 0) break
        offset += LIST_PAGE
      }
      const fetched = await Promise.all(
        ids.map(async (id) => {
          const res = await client.api.runs[':id'].$get({ param: { id } })
          return res.ok ? ((await res.json()) as DetailData) : null
        }),
      )
      setDetails(fetched.filter((d): d is DetailData => d !== null))
      setLoading(false)
    })()
  }, [clearSession])

  const scoreTrend = useMemo(
    () =>
      [...details]
        .filter((d) => d.finalScore != null)
        .sort((a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime())
        .map((d, i) => ({ n: i + 1, score: d.finalScore as number })),
    [details],
  )

  // catalogId をキーに頻度集計（表示名は不安定なので集計キーにしない）。
  const upgradeFreq = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const d of details) {
      for (const e of d.upgradeEntries) {
        if (e.entryType !== 'upgrade' || !e.catalogId) continue
        const cur = counts.get(e.catalogId) ?? { name: e.name ?? e.catalogId, count: 0 }
        cur.count += 1
        counts.set(e.catalogId, cur)
      }
    }
    return [...counts.entries()]
      .map(([catalogId, v]) => ({ catalogId, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
  }, [details])

  // 選択アップグレード（既定は最頻）。
  const selectedId = selected ?? upgradeFreq[0]?.catalogId ?? null

  // 選択アップグレードの「何手目（upgradeOrder）」分布。
  const orderDist = useMemo(() => {
    if (!selectedId) return []
    const counts = new Map<number, number>()
    for (const d of details) {
      for (const e of d.upgradeEntries) {
        if (e.entryType === 'upgrade' && e.catalogId === selectedId && e.upgradeOrder != null) {
          counts.set(e.upgradeOrder, (counts.get(e.upgradeOrder) ?? 0) + 1)
        }
      }
    }
    return [...counts.entries()]
      .map(([order, count]) => ({ order: `${order}手目`, orderNum: order, count }))
      .sort((a, b) => a.orderNum - b.orderNum)
  }, [details, selectedId])

  // 選択アップグレードの「何週」分布。
  const weekDist = useMemo(() => {
    if (!selectedId) return []
    const counts = new Map<number, number>()
    for (const d of details) {
      for (const e of d.upgradeEntries) {
        if (e.entryType === 'upgrade' && e.catalogId === selectedId) {
          counts.set(e.weekIndex, (counts.get(e.weekIndex) ?? 0) + 1)
        }
      }
    }
    return [...counts.entries()]
      .map(([week, count]) => ({ week: `WEEK ${week}`, weekNum: week, count }))
      .sort((a, b) => a.weekNum - b.weekNum)
  }, [details, selectedId])

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

  const selectedName = upgradeFreq.find((u) => u.catalogId === selectedId)?.name ?? ''

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
        <ResponsiveContainer
          width="100%"
          height={Math.max(240, Math.min(upgradeFreq.length, 15) * 26)}
        >
          <BarChart
            data={upgradeFreq.slice(0, 15)}
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
            {upgradeFreq.map((u) => (
              <option key={u.catalogId} value={u.catalogId}>
                {u.name}（{u.count}）
              </option>
            ))}
          </select>
        </div>
        <p className="text-slate-500 text-xs">
          「{selectedName}」が全体で何手目・何週に取られたかの分布（catalog ID で集計）。
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={orderDist} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="order" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={12} width={40} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#33415533' }} />
                <Bar dataKey="count" fill="#fbbf24" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="pb-1 text-center text-slate-500 text-xs">取得順（何手目）</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekDist} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="week" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={12} width={40} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#33415533' }} />
                <Bar dataKey="count" fill="#38bdf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="pb-1 text-center text-slate-500 text-xs">取得週</p>
          </div>
        </div>
      </section>
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
