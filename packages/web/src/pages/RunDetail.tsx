// ラン詳細。コア指標・UPGRADE HISTORY（週ごと）・REWARD LEDGER を表示。削除も可能。

import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { client } from '../api'
import { useAuth } from '../lib/auth'

interface UpgradeEntry {
  id: string
  weekIndex: number
  orderInWeek: number
  entryType: 'upgrade' | 'reroll'
  upgradeOrder: number | null
  flavorText: string | null
  name: string | null
  kind: string | null
  verified: boolean | null
}
interface RewardEntry {
  id: string
  name: string
  verified: boolean | null
  count: number
  points: number
}
interface RunDetailData {
  id: string
  playedAt: string
  status: 'draft' | 'confirmed'
  finalScore: number | null
  daysSurvived: number | null
  aliensDefeated: number | null
  nukesLaunched: number | null
  apocalypseBonus: number | null
  rerollCount: number
  upgradeEntries: UpgradeEntry[]
  rewardEntries: RewardEntry[]
  llmModel: string | null
  sourceNote: string | null
}

export function RunDetail() {
  const { id } = useParams({ from: '/runs/$id' })
  const navigate = useNavigate()
  const { clearSession } = useAuth()
  const [run, setRun] = useState<RunDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const res = await client.api.runs[':id'].$get({ param: { id } })
        if (res.status === 401) {
          clearSession()
          return
        }
        if (res.ok) {
          setRun((await res.json()) as RunDetailData)
        } else {
          setNotFound(true)
        }
      } catch {
        // 通信失敗も「見つからない」扱いにして永久ローディングを避ける。
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    })()
  }, [id, clearSession])

  async function remove() {
    if (!confirm('このランを削除しますか？（元に戻せません）')) return
    const res = await client.api.runs[':id'].$delete({ param: { id } })
    if (res.ok) void navigate({ to: '/runs' })
  }

  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (notFound || !run) return <p className="text-slate-400">ランが見つかりません。</p>

  const weeks = groupByWeek(run.upgradeEntries)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-bold text-white text-xl">
            スコア {run.finalScore?.toLocaleString() ?? '—'}
          </h1>
          <p className="text-slate-400 text-sm">{formatDate(run.playedAt)}</p>
        </div>
        <button
          type="button"
          onClick={() => void remove()}
          className="rounded border border-red-500/50 px-3 py-1.5 text-red-400 text-sm hover:bg-red-500/10"
        >
          削除
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="生存日数" value={run.daysSurvived} />
        <Stat label="撃破エイリアン" value={run.aliensDefeated} />
        <Stat label="発射核" value={run.nukesLaunched} />
        <Stat label="ボーナス" value={run.apocalypseBonus} />
        <Stat label="リロール" value={run.rerollCount} />
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-200">UPGRADE HISTORY</h2>
        {weeks.map(([week, entries]) => (
          <div key={week} className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
            <h3 className="mb-2 font-medium text-slate-400 text-sm">WEEK {week}</h3>
            <ol className="space-y-1">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="w-6 text-right font-mono text-slate-500">{e.orderInWeek}</span>
                  {e.entryType === 'reroll' ? (
                    <span className="text-slate-500 italic">↻ {e.flavorText ?? 'リロール'}</span>
                  ) : (
                    <span className="text-slate-200">
                      {e.name}
                      {e.kind === 'opportunity_upgrade' && (
                        <span className="ml-2 rounded bg-cyan-500/20 px-1.5 py-0.5 text-cyan-300 text-xs">
                          OU
                        </span>
                      )}
                      {e.verified === false && (
                        <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300 text-xs">
                          未検証
                        </span>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-200">REWARD LEDGER</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">名前</th>
                <th className="px-4 py-2 text-right font-medium">回数</th>
                <th className="px-4 py-2 text-right font-medium">ポイント</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {run.rewardEntries.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-slate-200">
                    {r.name}
                    {r.verified === false && (
                      <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300 text-xs">
                        未検証
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{r.count}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.points.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(run.llmModel || run.sourceNote) && (
        <p className="text-slate-500 text-xs">
          {run.llmModel && `LLM: ${run.llmModel}`}
          {run.sourceNote && ` / ${run.sourceNote}`}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
      <div className="font-mono text-lg text-white">{value?.toLocaleString() ?? '—'}</div>
      <div className="text-slate-400 text-xs">{label}</div>
    </div>
  )
}

function groupByWeek(entries: UpgradeEntry[]): [number, UpgradeEntry[]][] {
  const map = new Map<number, UpgradeEntry[]>()
  for (const e of entries) {
    const list = map.get(e.weekIndex) ?? []
    list.push(e)
    map.set(e.weekIndex, list)
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0])
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
}
