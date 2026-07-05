// ラン一覧。owner の run を新しい順に表示。ページング対応。行クリックで詳細へ。

import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { client } from '../api'
import { AnalysisBadge, type AnalysisStatus, isAnalysisActive } from '../components/AnalysisBadge'
import { StatusBadge } from '../components/StatusBadge'
import { useAuth } from '../lib/auth'

interface RunRow {
  id: string
  playedAt: string
  status: 'draft' | 'confirmed'
  finalScore: number | null
  daysSurvived: number | null
  apocalypseBonus: number | null
  rerollCount: number
  analysisStatus: AnalysisStatus | null
}

const PAGE_SIZE = 50

export function Runs() {
  const { clearSession } = useAuth()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (nextOffset: number, options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true)
      setError(null)
      try {
        const res = await client.api.runs.$get({
          query: { limit: String(PAGE_SIZE), offset: String(nextOffset) },
        })
        if (res.status === 401) {
          clearSession()
          return
        }
        if (!res.ok) throw new Error(`status ${res.status}`)
        const data = (await res.json()) as { runs: RunRow[]; total: number }
        setRuns(data.runs)
        setTotal(data.total)
        setOffset(nextOffset)
      } catch {
        setError('ラン一覧の取得に失敗しました。時間をおいて再読み込みしてください。')
      } finally {
        if (!options?.silent) setLoading(false)
      }
    },
    [clearSession],
  )

  useEffect(() => {
    void load(0)
  }, [load])

  // 解析待ち/解析中の run が見えている間だけ、数秒間隔で静かに再取得する（prd/04 §9.5）。
  useEffect(() => {
    if (!runs.some((run) => isAnalysisActive(run.analysisStatus))) return
    const timer = setInterval(() => void load(offset, { silent: true }), 5000)
    return () => clearInterval(timer)
  }, [runs, offset, load])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

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

      {loading ? (
        <p className="text-slate-400">読み込み中…</p>
      ) : error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : runs.length === 0 ? (
        <p className="text-slate-400 text-sm">
          まだランがありません。「インポート」から結果を登録してください。
        </p>
      ) : (
        <>
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
                      <span className="flex items-center gap-1.5">
                        <StatusBadge status={run.status} />
                        <AnalysisBadge status={run.analysisStatus} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-slate-400 text-sm">
            <span>
              {from}–{to} / {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="rounded border border-slate-600 px-3 py-1 hover:bg-slate-700 disabled:opacity-40"
              >
                前へ
              </button>
              <button
                type="button"
                onClick={() => void load(offset + PAGE_SIZE)}
                disabled={to >= total}
                className="rounded border border-slate-600 px-3 py-1 hover:bg-slate-700 disabled:opacity-40"
              >
                次へ
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
}
