// スクショ自動解析のアップロードフォーム（admin 限定・インポート画面に統合。prd/04 §9.1）。
// 画像 1〜5 枚を multipart で送信 → 空 draft run + 解析ジョブが作られ、run 詳細へ遷移する。
// どの画像がどの画面（section）かは聞かない（LLM の分類に任せる）。

import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { API_BASE_URL } from '../api'
import { useAuth } from '../lib/auth'

const MAX_IMAGES = 5
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function ScreenshotUpload() {
  const navigate = useNavigate()
  const { clearSession } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pickFiles(selected: FileList | null) {
    setError(null)
    const list = [...(selected ?? [])]
    if (list.length > MAX_IMAGES) {
      setError(`画像は最大 ${MAX_IMAGES} 枚までです`)
      setFiles(list.slice(0, MAX_IMAGES))
      return
    }
    setFiles(list)
  }

  async function submit() {
    if (files.length === 0) return
    const oversize = files.find((f) => f.size > MAX_IMAGE_BYTES)
    if (oversize) {
      setError(`${oversize.name} が 10MB を超えています`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      for (const file of files) form.append('images', file)
      // 配列フィールドつき multipart は素の fetch で送る（cookie セッションを同送）。
      const res = await fetch(`${API_BASE_URL}/api/screenshots`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (res.status === 401) {
        clearSession()
        return
      }
      const data = (await res.json()) as { ok: boolean; runId?: string; error?: string }
      if (res.ok && data.runId) {
        void navigate({ to: '/runs/$id', params: { id: data.runId } })
      } else {
        setError(data.error ?? `アップロードに失敗しました (${res.status})`)
      }
    } catch {
      setError('アップロードリクエストに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold text-slate-200 text-sm">スクショ自動解析</h2>
        <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-indigo-300 text-xs">
          admin
        </span>
      </div>
      <p className="mb-3 text-slate-400 text-sm">
        リザルト系スクショ（結果 / UPGRADE HISTORY / REWARD LEDGER）を 1〜{MAX_IMAGES} 枚
        そのまま投げると、サーバ側で解析してランを登録します。どの画像がどの画面かの指定は不要です。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(e) => pickFiles(e.target.files)}
          className="text-slate-300 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-slate-200 file:text-sm hover:file:bg-slate-600"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || files.length === 0}
          className="rounded bg-indigo-600 px-4 py-1.5 font-medium text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'アップロード中…' : '解析を開始'}
        </button>
      </div>
      {files.length > 0 && (
        <ul className="mt-2 text-slate-500 text-xs">
          {files.map((f) => (
            <li key={f.name}>
              {f.name}（{(f.size / 1024 / 1024).toFixed(1)}MB）
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
    </div>
  )
}
