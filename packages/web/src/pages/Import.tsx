// インポート画面。JSON/YAML を貼り付け → 検証（error/warning 表示）→ draft/confirmed 保存。
// 分析キット（JSON Schema）ダウンロード導線も提供する（prd/04 §3・§4・§6）。

import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { API_BASE_URL, client } from '../api'
import oneshotPrompt from '../assets/oneshot-prompt.txt?raw'
import { useAuth } from '../lib/auth'

interface Issue {
  level: 'error' | 'warning'
  code: string
  message: string
  path: (string | number)[]
}
interface ValidateResult {
  ok: boolean
  format: 'json' | 'yaml' | null
  issues: Issue[]
}

type Format = 'auto' | 'json' | 'yaml'

const EXAMPLE = `game: UTOPIA MUST FALL
result:
  days_survived: 10
  final_score: 143161
  aliens_defeated: 1336
  nukes_launched: 3
  apocalypse_bonus: 1208
upgrade_history:
  - { week: 1, type: upgrade, name: NUCLEAR WEAPONS LAB }
  - { week: 2, type: reroll, flavor: DIGITIZE CONSCIOUSNESS }
reward_ledger:
  - { name: BOHEMIAN, count: 1, points: 1208 }`

export function Import() {
  const navigate = useNavigate()
  const { clearSession } = useAuth()
  const [text, setText] = useState('')
  const [format, setFormat] = useState<Format>('auto')
  const [result, setResult] = useState<ValidateResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [promptCopied, setPromptCopied] = useState(false)

  const errors = result?.issues.filter((i) => i.level === 'error') ?? []
  const warnings = result?.issues.filter((i) => i.level === 'warning') ?? []
  const canSave = result?.ok === true

  // 入力・フォーマットを変えたら古い検証結果を捨てる（未レビューのまま保存できないように）。
  function changeText(v: string) {
    setText(v)
    setResult(null)
    setError(null)
  }
  function changeFormat(v: Format) {
    setFormat(v)
    setResult(null)
    setError(null)
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(oneshotPrompt)
      setPromptCopied(true)
      setTimeout(() => setPromptCopied(false), 2000)
    } catch {
      setError('クリップボードへのコピーに失敗しました')
    }
  }

  async function validate() {
    setBusy(true)
    setError(null)
    try {
      const res = await client.api.ingest.validate.$post({ json: { text, format } })
      if (res.status === 401) {
        clearSession()
        return
      }
      setResult((await res.json()) as ValidateResult)
    } catch {
      setError('検証リクエストに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function save(status: 'draft' | 'confirmed') {
    setBusy(true)
    setError(null)
    try {
      const res = await client.api.runs.$post({
        json: { text, format, status, source: 'paste' },
      })
      if (res.status === 401) {
        clearSession()
        return
      }
      const data = (await res.json()) as { ok: boolean; runId?: string; issues?: Issue[] }
      if (res.ok && data.runId) {
        void navigate({ to: '/runs/$id', params: { id: data.runId } })
      } else {
        setResult({ ok: false, format: null, issues: data.issues ?? [] })
        setError('保存できませんでした。エラーを解消してください。')
      }
    } catch {
      setError('保存リクエストに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-white text-xl">インポート</h1>
        <a
          href={`${API_BASE_URL}/api/ingest/json-schema`}
          target="_blank"
          rel="noreferrer"
          className="text-indigo-400 text-sm hover:underline"
        >
          JSON Schema を開く
        </a>
      </div>

      <p className="text-slate-400 text-sm">
        リザルト画面のスクショを自前の LLM で解析した JSON/YAML を貼り付けてください。
        記法は下の例と同じフラット形（week / type / name|flavor）でも、正規形でも受理します。
      </p>

      <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-slate-300 text-sm">
            スクショ3枚（結果 / UPGRADE HISTORY / REWARD LEDGER）と一緒に LLM へ貼るプロンプト
          </p>
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="rounded border border-slate-600 px-3 py-1 font-medium text-slate-200 text-sm hover:bg-slate-700"
          >
            {promptCopied ? 'コピーしました ✓' : 'LLM プロンプトをコピー'}
          </button>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-500 text-xs hover:text-slate-300">
            本文を表示
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-slate-300 text-xs">
            {oneshotPrompt}
          </pre>
        </details>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <label className="text-slate-400 text-sm" htmlFor="format">
            フォーマット
          </label>
          <select
            id="format"
            value={format}
            onChange={(e) => changeFormat(e.target.value as Format)}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200 text-sm"
          >
            <option value="auto">自動判定</option>
            <option value="json">JSON</option>
            <option value="yaml">YAML</option>
          </select>
          <button
            type="button"
            onClick={() => changeText(EXAMPLE)}
            className="text-slate-400 text-xs hover:text-slate-200 hover:underline"
          >
            例を挿入
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => changeText(e.target.value)}
          rows={14}
          spellCheck={false}
          placeholder={EXAMPLE}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-slate-200 text-sm focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void validate()}
          disabled={busy || text.trim().length === 0}
          className="rounded bg-slate-700 px-4 py-2 font-medium text-sm text-white hover:bg-slate-600 disabled:opacity-50"
        >
          検証
        </button>
        <button
          type="button"
          onClick={() => void save('draft')}
          disabled={busy || !canSave}
          className="rounded border border-slate-600 px-4 py-2 font-medium text-slate-200 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          ドラフト保存
        </button>
        <button
          type="button"
          onClick={() => void save('confirmed')}
          disabled={busy || !canSave}
          className="rounded bg-indigo-600 px-4 py-2 font-medium text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          確定保存
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {result && (
        <div className="space-y-3">
          {result.ok ? (
            <p className="text-emerald-400 text-sm">
              検証 OK（{result.format?.toUpperCase()}）。
              {warnings.length > 0 && ' warning があります（確定保存は可能）。'}
            </p>
          ) : (
            <p className="text-red-400 text-sm">エラーがあります。確定できません。</p>
          )}
          {errors.length > 0 && (
            <IssueList title="エラー（確定不可）" issues={errors} tone="error" />
          )}
          {warnings.length > 0 && (
            <IssueList title="警告（確定可・要確認）" issues={warnings} tone="warning" />
          )}
        </div>
      )}
    </div>
  )
}

function IssueList({
  title,
  issues,
  tone,
}: {
  title: string
  issues: Issue[]
  tone: 'error' | 'warning'
}) {
  const color =
    tone === 'error' ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10'
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <h2 className="mb-2 font-semibold text-slate-200 text-sm">{title}</h2>
      <ul className="space-y-1">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${i}`} className="text-slate-300 text-sm">
            <span className="text-slate-500">{issue.path.join('.') || '—'}: </span>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
