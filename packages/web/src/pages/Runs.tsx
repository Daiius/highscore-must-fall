// ラン一覧。owner の run を新しい順に表示。行クリックで詳細へ。

import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { client } from '../api'

interface RunRow {
  id: string
  playedAt: string
  status: 'draft' | 'confirmed'
  finalScore: number | null
  daysSurvived: number | null
  apocalypseBonus: number | null
  rerollCount: number
}

export function Runs() {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const res = await client.api.runs.$get({ query: { limit: '100', offset: '0' } })
      const data = (await res.json()) as { runs: RunRow[]; total: number }
      setRuns(data.runs)
      setTotal(data.total)
      setLoading(false)
    })()
  }, [])

  if (loading) return <p className="text-slate-400">読み込み中…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-white text-xl">ラン一覧（{total}）</h1>
        <Link
          to="/import"
          className="rounded bg-indigo-600 px-4 py-2 font-medium text-sm text-white hover:bg-indigo-500"
        >
          + インポート
        </Link>
      </div>

      {runs.length === 0 ? (
        <p className="text-slate-400 text-sm">
          まだランがありません。「インポート」から結果を登録してください。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">日時</th>
                <th className="px-4 py-2 text-right font-medium">スコア</th>
                <th className="px-4 py-2 text-right font-medium">生存日数</th>
                <th className="px-4 py-2 text-right font-medium">ボーナス</th>
                <th className="px-4 py-2 text-right font-medium">リロール</th>
                <th className="px-4 py-2 text-left font-medium">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-slate-800/50">
                  <td className="px-4 py-2">
                    <Link
                      to="/runs/$id"
                      params={{ id: run.id }}
                      className="text-indigo-400 hover:underline"
                    >
                      {formatDate(run.playedAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {run.finalScore?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{run.daysSurvived ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {run.apocalypseBonus?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{run.rerollCount}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={run.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: 'draft' | 'confirmed' }) {
  return status === 'confirmed' ? (
    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300 text-xs">確定</span>
  ) : (
    <span className="rounded bg-slate-600/40 px-2 py-0.5 text-slate-300 text-xs">ドラフト</span>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
}
