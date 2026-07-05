// ラン詳細。コア指標・UPGRADE HISTORY（週ごと）・REWARD LEDGER を表示。
// draft は「確定する」で confirmed へ遷移（server 側で raw_payload を再検証）。削除も可能。

import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL, client } from '../api'
import { AnalysisBadge, type AnalysisStatus, isAnalysisActive } from '../components/AnalysisBadge'
import { StatusBadge } from '../components/StatusBadge'
import { canUseAutoAnalysis, useAuth } from '../lib/auth'

interface Issue {
  level: 'error' | 'warning'
  code: string
  message: string
  path: (string | number)[]
}

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
interface RunImage {
  id: string
  section: 'result' | 'upgrade_history' | 'reward_ledger' | 'other'
  contentType: string
  byteSize: number
  width: number | null
  height: number | null
}
interface AnalysisJobInfo {
  status: AnalysisStatus
  attemptCount: number
  lastError: string | null
  llmModel: string | null
  updatedAt: string
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
  images: RunImage[]
  analysisJob: AnalysisJobInfo | null
  llmModel: string | null
  sourceNote: string | null
}

const SECTION_LABELS: Record<RunImage['section'], string> = {
  result: '結果画面',
  upgrade_history: 'UPGRADE HISTORY',
  reward_ledger: 'REWARD LEDGER',
  other: '未分類',
}

export function RunDetail() {
  const { id } = useParams({ from: '/runs/$id' })
  const navigate = useNavigate()
  const { user, clearSession } = useAuth()
  const [run, setRun] = useState<RunDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmIssues, setConfirmIssues] = useState<Issue[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  // メニューは外側クリックで閉じる（トグルボタン側は stopPropagation で除外）。
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpen])

  const fetchRun = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true)
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
        // 初回の通信失敗は「見つからない」扱いにして永久ローディングを避ける（polling 中は無視）。
        if (!options?.silent) setNotFound(true)
      } finally {
        if (!options?.silent) setLoading(false)
      }
    },
    [id, clearSession],
  )

  useEffect(() => {
    void fetchRun()
  }, [fetchRun])

  // 解析待ち/解析中の間だけ数秒間隔で静かに再取得する（prd/04 §9.5）。
  useEffect(() => {
    if (!isAnalysisActive(run?.analysisJob?.status)) return
    const timer = setInterval(() => void fetchRun({ silent: true }), 5000)
    return () => clearInterval(timer)
  }, [run?.analysisJob?.status, fetchRun])

  async function reanalyze() {
    setBusy(true)
    setActionError(null)
    try {
      const res = await client.api.runs[':id'].reanalyze.$post({ param: { id } })
      if (res.status === 401) {
        clearSession()
        return
      }
      if (res.ok) {
        await fetchRun({ silent: true })
      } else {
        const data = (await res.json()) as { error?: string }
        setActionError(data.error ?? '再解析を開始できませんでした')
      }
    } catch {
      setActionError('リクエストに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('このランを削除しますか？（元に戻せません）')) return
    const res = await client.api.runs[':id'].$delete({ param: { id } })
    if (res.ok) void navigate({ to: '/runs' })
  }

  async function changeStatus(status: 'draft' | 'confirmed') {
    setBusy(true)
    setActionError(null)
    setConfirmIssues([])
    try {
      const res = await client.api.runs[':id'].$patch({ param: { id }, json: { status } })
      if (res.status === 401) {
        clearSession()
        return
      }
      const data = (await res.json()) as { ok?: boolean; issues?: Issue[] }
      if (res.ok && data.ok) {
        setRun((prev) => (prev ? { ...prev, status } : prev))
        // 確定は成功しても warning は残せる（要確認として表示し続ける）。
        setConfirmIssues(data.issues ?? [])
      } else {
        setActionError(
          status === 'confirmed'
            ? '確定できませんでした。検証エラーを確認してください。'
            : '下書きに戻せませんでした。',
        )
        setConfirmIssues(data.issues ?? [])
      }
    } catch {
      setActionError('リクエストに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (notFound || !run) return <p className="text-slate-400">ランが見つかりません。</p>

  const weeks = groupByWeek(run.upgradeEntries)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-bold text-white text-xl">
            スコア {run.finalScore?.toLocaleString() ?? '—'}
            <StatusBadge status={run.status} />
            <AnalysisBadge status={run.analysisJob?.status} />
          </h1>
          <p className="text-slate-400 text-sm">{formatDate(run.playedAt)}</p>
        </div>
        <div className="relative flex gap-3">
          {run.status === 'draft' && (
            <button
              type="button"
              onClick={() => void changeStatus('confirmed')}
              disabled={busy}
              className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              確定する
            </button>
          )}
          <button
            type="button"
            aria-label="その他の操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((o) => !o)
            }}
            className="rounded border border-slate-600 px-2.5 py-1.5 text-slate-300 text-sm hover:bg-slate-700"
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute top-full right-0 z-10 mt-1 w-40 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-lg"
            >
              {run.status === 'confirmed' && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false)
                    void changeStatus('draft')
                  }}
                  className="w-full px-3 py-1.5 text-left text-slate-200 text-sm hover:bg-slate-700 disabled:opacity-50"
                >
                  下書きに戻す
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  void remove()
                }}
                className="w-full px-3 py-1.5 text-left text-red-400 text-sm hover:bg-slate-700"
              >
                削除
              </button>
            </div>
          )}
        </div>
      </div>

      {actionError && <p className="text-red-400 text-sm">{actionError}</p>}

      {run.analysisJob && (
        <AnalysisJobPanel
          job={run.analysisJob}
          canReanalyze={
            canUseAutoAnalysis(user) &&
            run.status === 'draft' &&
            !isAnalysisActive(run.analysisJob.status)
          }
          busy={busy}
          onReanalyze={() => void reanalyze()}
        />
      )}
      {confirmIssues.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <h2 className="mb-2 font-semibold text-slate-200 text-sm">確定時の検証結果</h2>
          <ul className="space-y-1">
            {confirmIssues.map((issue, i) => (
              <li key={`${issue.code}-${i}`} className="text-slate-300 text-sm">
                <span className={issue.level === 'error' ? 'text-red-400' : 'text-amber-300'}>
                  [{issue.level}]
                </span>{' '}
                <span className="text-slate-500">{issue.path.join('.') || '—'}: </span>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {run.images.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-slate-200">スクリーンショット</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {run.images.map((image) => (
              <figure
                key={image.id}
                className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50"
              >
                <img
                  src={`${API_BASE_URL}/api/runs/${run.id}/images/${image.id}`}
                  alt={SECTION_LABELS[image.section]}
                  loading="lazy"
                  width={image.width ?? undefined}
                  height={image.height ?? undefined}
                  className="h-auto w-full"
                />
                <figcaption className="px-3 py-1.5 text-slate-400 text-xs">
                  {SECTION_LABELS[image.section]}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {(run.llmModel || run.sourceNote) && (
        <p className="text-slate-500 text-xs">
          {run.llmModel && `LLM: ${run.llmModel}`}
          {run.sourceNote && ` / ${run.sourceNote}`}
        </p>
      )}
    </div>
  )
}

function AnalysisJobPanel({
  job,
  canReanalyze,
  busy,
  onReanalyze,
}: {
  job: AnalysisJobInfo
  canReanalyze: boolean
  busy: boolean
  onReanalyze: () => void
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        job.status === 'failed'
          ? 'border-red-500/40 bg-red-500/10'
          : 'border-slate-700 bg-slate-800/50'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-slate-300 text-sm">
          自動解析: {job.status === 'queued' && '解析待ち（worker の polling を待っています）'}
          {job.status === 'running' && '解析中…'}
          {job.status === 'succeeded' && '解析済み'}
          {job.status === 'failed' && '失敗しました'}
          <span className="ml-2 text-slate-500 text-xs">
            試行 {job.attemptCount} 回{job.llmModel && ` / ${job.llmModel}`} /{' '}
            {formatDate(job.updatedAt)}
          </span>
        </p>
        {canReanalyze && (
          <button
            type="button"
            onClick={onReanalyze}
            disabled={busy}
            className="rounded border border-slate-600 px-3 py-1 font-medium text-slate-200 text-sm hover:bg-slate-700 disabled:opacity-50"
          >
            再解析
          </button>
        )}
      </div>
      {job.status === 'failed' && job.lastError && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-slate-300 text-xs">
          {job.lastError}
        </pre>
      )}
      {job.status === 'failed' && (
        <p className="mt-2 text-slate-400 text-xs">
          再解析で直らない場合は、下のスクショを自前の LLM に渡して手動インポートでも登録できます。
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
