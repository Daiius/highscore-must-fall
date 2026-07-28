// ラン一覧。owner の run を新しい順に表示。ページング対応。行クリックで詳細へ。

import { Link } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { client } from '../api'
import { AnalysisBadge, type AnalysisStatus, isAnalysisActive } from '../components/AnalysisBadge'
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  SparklesIcon,
  TrophyIcon,
} from '../components/Icons'
import { StatusBadge } from '../components/StatusBadge'
import { callApi } from '../lib/api-result'
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

const HEADER_ICON_CLASS = 'size-4'

/**
 * 一覧の列定義。狭幅では見出しをアイコンに差し替える（日本語ラベルを 6 列並べると
 * 1 文字ずつ縦積みになるため）。`tipAnchor` はタップ時のツールチップを cell の
 * どちら側に寄せるか——テーブルは overflow-x-auto の中なので、外へはみ出す側に
 * 出すと切れる。先頭列だけ左寄せ、残りは右寄せにして内側へ伸ばす。
 */
const COLUMNS = [
  {
    label: '日時',
    icon: <ClockIcon className={HEADER_ICON_CLASS} />,
    align: 'left',
    tipAnchor: 'left',
  },
  {
    label: 'スコア',
    icon: <TrophyIcon className={HEADER_ICON_CLASS} />,
    align: 'right',
    tipAnchor: 'right',
  },
  {
    label: '生存日数',
    icon: <CalendarDaysIcon className={HEADER_ICON_CLASS} />,
    align: 'right',
    tipAnchor: 'right',
  },
  {
    label: 'ボーナス',
    icon: <SparklesIcon className={HEADER_ICON_CLASS} />,
    align: 'right',
    tipAnchor: 'right',
  },
  {
    label: 'リロール',
    icon: <ArrowPathIcon className={HEADER_ICON_CLASS} />,
    align: 'right',
    tipAnchor: 'right',
  },
  {
    label: '状態',
    icon: <CheckCircleIcon className={HEADER_ICON_CLASS} />,
    align: 'left',
    tipAnchor: 'right',
  },
] as const satisfies readonly {
  label: string
  icon: ReactNode
  align: 'left' | 'right'
  tipAnchor: 'left' | 'right'
}[]

export function Runs() {
  const { clearSession } = useAuth()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 狭幅で見出しをアイコンにしたとき、タップで開いている列ラベル（null = 閉じている）。
  const [openTip, setOpenTip] = useState<string | null>(null)

  // ツールチップは外側クリックで閉じる（アイコン側は stopPropagation で除外）。
  useEffect(() => {
    if (openTip === null) return
    const close = () => setOpenTip(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openTip])

  const load = useCallback(
    async (nextOffset: number, options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true)
      setError(null)
      const result = await callApi<{ runs: RunRow[]; total: number }>(() =>
        client.api.runs.$get({ query: { limit: String(PAGE_SIZE), offset: String(nextOffset) } }),
      )
      if (!options?.silent) setLoading(false)
      if (result.ok) {
        setRuns(result.value.runs)
        setTotal(result.value.total)
        setOffset(nextOffset)
      } else if (result.error.kind === 'unauthorized') {
        clearSession()
      } else {
        setError('ラン一覧の取得に失敗しました。時間をおいて再読み込みしてください。')
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
                  {COLUMNS.map((col) => (
                    <ColumnHeader
                      key={col.label}
                      label={col.label}
                      icon={col.icon}
                      align={col.align}
                      tipAnchor={col.tipAnchor}
                      open={openTip === col.label}
                      onToggle={() =>
                        setOpenTip((current) => (current === col.label ? null : col.label))
                      }
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-800/50">
                    <td className="px-2 py-2 sm:px-4">
                      <Link
                        to="/runs/$id"
                        params={{ id: run.id }}
                        className="text-indigo-400 hover:underline"
                      >
                        {formatDate(run.playedAt)}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right font-mono sm:px-4">
                      {run.finalScore?.toLocaleString() ?? '—'}
                    </td>
                    <td className="px-2 py-2 text-right font-mono sm:px-4">
                      {run.daysSurvived ?? '—'}
                    </td>
                    <td className="px-2 py-2 text-right font-mono sm:px-4">
                      {run.apocalypseBonus?.toLocaleString() ?? '—'}
                    </td>
                    <td className="px-2 py-2 text-right font-mono sm:px-4">{run.rerollCount}</td>
                    <td className="px-2 py-2 sm:px-4">
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
                aria-label="前へ"
                title="前へ"
                className="flex items-center gap-1 rounded border border-slate-600 p-1.5 hover:bg-slate-700 disabled:opacity-40 sm:px-3 sm:py-1"
              >
                <ChevronLeftIcon className="size-4 shrink-0" />
                <span className="hidden sm:inline">前へ</span>
              </button>
              <button
                type="button"
                onClick={() => void load(offset + PAGE_SIZE)}
                disabled={to >= total}
                aria-label="次へ"
                title="次へ"
                className="flex items-center gap-1 rounded border border-slate-600 p-1.5 hover:bg-slate-700 disabled:opacity-40 sm:px-3 sm:py-1"
              >
                <span className="hidden sm:inline">次へ</span>
                <ChevronRightIcon className="size-4 shrink-0" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * 一覧の列見出し。sm 以上はテキスト、狭幅ではアイコン。
 * タッチ環境には hover が無く `title` 属性が読めないので、アイコンはボタンにして
 * タップでラベルをツールチップ表示する。
 */
function ColumnHeader({
  label,
  icon,
  align,
  tipAnchor,
  open,
  onToggle,
}: {
  label: string
  icon: ReactNode
  align: 'left' | 'right'
  tipAnchor: 'left' | 'right'
  open: boolean
  onToggle: () => void
}) {
  return (
    <th
      className={`relative px-2 py-2 font-medium sm:px-4 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          // document の click ハンドラ（外側クリックで閉じる）に自分の click を拾わせない。
          e.stopPropagation()
          onToggle()
        }}
        className="inline-flex align-middle text-slate-400 hover:text-slate-200 sm:hidden"
      >
        {icon}
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-full z-10 mt-1 whitespace-nowrap rounded border border-slate-600 bg-slate-700 px-2 py-1 font-normal text-slate-100 text-xs shadow-lg sm:hidden ${tipAnchor === 'left' ? 'left-2' : 'right-2'}`}
        >
          {label}
        </span>
      )}
    </th>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
}
