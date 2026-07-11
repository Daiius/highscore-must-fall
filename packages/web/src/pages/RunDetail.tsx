// ラン詳細。コア指標・UPGRADE HISTORY（週ごと）・REWARD LEDGER を表示。
// draft は「編集」で中身を手動修正でき（RunEditor）、「確定する」で confirmed へ遷移する
// （server 側で raw_payload を再検証）。削除も可能。

import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { client } from '../api'
import { AnalysisBadge, isAnalysisActive } from '../components/AnalysisBadge'
import { CatalogBadges } from '../components/CatalogBadges'
import { RunEditor } from '../components/RunEditor'
import { ScreenshotSection } from '../components/ScreenshotSection'
import { StatusBadge } from '../components/StatusBadge'
import { SuggestHint } from '../components/SuggestHint'
import { callApi } from '../lib/api-result'
import { canUseAutoAnalysis, useAuth } from '../lib/auth'
import { suggestFromCatalog, useCatalog } from '../lib/catalog'
import type { AnalysisJobInfo, Issue, RunDetailData, UpgradeEntry } from '../lib/run-types'

// 表示モードでも候補を出す（confirmed でも）。編集画面でだけ提案すると、気づける機会をそこでしか
// 得られないため。出す/出さないの判断は suggestFromCatalog に集約している（verified 名と一致すれば出ない）。

export function RunDetail() {
  const { id } = useParams({ from: '/runs/$id' })
  const navigate = useNavigate()
  const { user, clearSession } = useAuth()
  const catalog = useCatalog()
  const [run, setRun] = useState<RunDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  // メニューは外側クリックで閉じる（トグルボタン側は stopPropagation で除外）。
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpen])

  // メモ化は React Compiler が行う（useCallback を書かない。.claude/rules/react.md）。
  // 下の useEffect はこの関数の識別子に依存するので、コンパイラが必ずメモ化することが前提。
  // vite.config.ts の panicThreshold: 'all_errors' がその前提をビルド時に保証する。
  const fetchRun = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    const result = await callApi<RunDetailData>(() =>
      client.api.runs[':id'].$get({ param: { id } }),
    )
    if (!options?.silent) setLoading(false)
    if (result.ok) {
      setRun(result.value)
    } else if (result.error.kind === 'unauthorized') {
      clearSession()
    } else if (result.error.kind === 'status') {
      setNotFound(true)
    } else if (!options?.silent) {
      // 初回の通信失敗は「見つからない」扱いにして永久ローディングを避ける（polling 中は無視）。
      setNotFound(true)
    }
  }

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
    const result = await callApi<{ ok: boolean }>(() =>
      client.api.runs[':id'].reanalyze.$post({ param: { id } }),
    )
    if (result.ok) {
      await fetchRun({ silent: true })
    } else if (result.error.kind === 'unauthorized') {
      clearSession()
    } else if (result.error.kind === 'status') {
      const body = result.error.body as { error?: string } | null
      setActionError(body?.error ?? '再解析を開始できませんでした')
    } else {
      setActionError('リクエストに失敗しました')
    }
    setBusy(false)
  }

  async function remove() {
    if (!confirm('このランを削除しますか？（元に戻せません）')) return
    // 204（本文なし）。callApi は json() 失敗を null に畳むので ok 判定だけ見る。
    const result = await callApi<null>(() => client.api.runs[':id'].$delete({ param: { id } }))
    if (result.ok) void navigate({ to: '/runs' })
  }

  async function changeStatus(status: 'draft' | 'confirmed') {
    setBusy(true)
    setActionError(null)
    setIssues([])
    const result = await callApi<{ ok: boolean; issues?: Issue[] }>(() =>
      client.api.runs[':id'].$patch({ param: { id }, json: { status } }),
    )
    setBusy(false)
    if (result.ok) {
      setRun((prev) => (prev ? { ...prev, status } : prev))
      // 確定は成功しても warning は残せる（要確認として表示し続ける）。
      setIssues(result.value.issues ?? [])
    } else if (result.error.kind === 'unauthorized') {
      clearSession()
    } else if (result.error.kind === 'network') {
      setActionError('リクエストに失敗しました')
    } else if (result.error.status === 409) {
      // 解析中に確定を試みた（通常ボタンは隠れているが、解析開始と競合した場合の保険）。
      setActionError('解析中は確定できません。解析の完了後にもう一度お試しください。')
      void fetchRun()
    } else {
      const body = result.error.body as { issues?: Issue[] } | null
      setActionError(
        status === 'confirmed'
          ? '確定できませんでした。検証エラーを確認してください。'
          : '下書きに戻せませんでした。',
      )
      setIssues(body?.issues ?? [])
    }
  }

  /** 手動修正の保存後。子エントリ・カタログが変わるので取り直す。warning は残して表示する。 */
  async function handleSaved(savedIssues: Issue[]) {
    setEditing(false)
    setActionError(null)
    setIssues(savedIssues)
    await fetchRun({ silent: true })
  }

  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (notFound || !run) return <p className="text-slate-400">ランが見つかりません。</p>

  const weeks = groupByWeek(run.upgradeEntries)
  // 解析中（queued/running）は中身が未確定なので編集も確定もさせない（backend でも 409 で拒否）。
  const mutable = run.status === 'draft' && !isAnalysisActive(run.analysisJob?.status)

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
          {/* 編集中は誤操作（確定・削除）を防ぐため、他の操作を出さない。 */}
          {mutable && !editing && (
            <>
              <button
                type="button"
                onClick={() => {
                  setIssues([])
                  setEditing(true)
                }}
                disabled={busy}
                className="rounded border border-slate-600 px-3 py-1.5 font-medium text-slate-200 text-sm hover:bg-slate-700 disabled:opacity-50"
              >
                編集
              </button>
              <button
                type="button"
                onClick={() => void changeStatus('confirmed')}
                disabled={busy}
                className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                確定する
              </button>
            </>
          )}
          {!editing && (
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
          )}
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
          canReanalyze={canUseAutoAnalysis(user) && run.analysisJob.reanalyzable}
          busy={busy}
          onReanalyze={() => void reanalyze()}
        />
      )}
      {issues.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <h2 className="mb-2 font-semibold text-slate-200 text-sm">検証結果</h2>
          <ul className="space-y-1">
            {issues.map((issue, i) => (
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

      {editing ? (
        // 編集中はスクショを右に固定して、原本を見ながら 1 行ずつ突き合わせられるようにする。
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <RunEditor
            run={run}
            catalog={catalog}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => void handleSaved(saved)}
          />
          <aside className="xl:sticky xl:top-4 xl:self-start">
            <ScreenshotSection run={run} column />
          </aside>
        </div>
      ) : (
        <>
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
                    <li key={e.id} className="space-y-0.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-right font-mono text-slate-500">
                          {e.orderInWeek}
                        </span>
                        {e.entryType === 'reroll' ? (
                          <span className="text-slate-500 italic">
                            ↻ {e.flavorText ?? 'リロール'}
                          </span>
                        ) : (
                          <span className="text-slate-200">
                            {e.name}
                            <CatalogBadges kind={e.kind} verified={e.verified} />
                          </span>
                        )}
                      </div>
                      <SuggestHint suggestions={suggestFromCatalog(e.name, catalog?.upgrades)} />
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
                        <CatalogBadges verified={r.verified} />
                        <SuggestHint suggestions={suggestFromCatalog(r.name, catalog?.rewards)} />
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{r.count}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        {r.points.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <ScreenshotSection run={run} />
        </>
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
          {job.status === 'running' &&
            (job.reanalyzable ? '解析中…（応答なし。再解析で復旧できます）' : '解析中…')}
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
