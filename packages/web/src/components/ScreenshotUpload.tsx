// スクショ自動解析のアップロードフォーム（admin 限定・インポート画面に統合。prd/04 §9.1）。
// 画像 1〜5 枚を multipart で送信 → 空 draft run + 解析ジョブが作られ、run 詳細へ遷移する。
// どの画像がどの画面（section）かは聞かない（LLM の分類に任せる）。
//
// 入力は 3 通り: ファイル選択 / ドラッグ&ドロップ / クリップボード貼り付け（⌘/Ctrl+V）。
// いずれも既存リストに追記する（最大 MAX_IMAGES 枚）。各画像は { id, file, url } で保持し、
// プレビュー URL をファイルに追従させる（index 対応にしない）。id を React key にする。

import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../api'
import { callApi } from '../lib/api-result'
import { useAuth } from '../lib/auth'

const MAX_IMAGES = 5
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const OVER_LIMIT_MSG = `画像は最大 ${MAX_IMAGES} 枚までです`

/** アップロード候補。プレビュー URL をファイルと同じ寿命で持つ。 */
interface UploadItem {
  id: number
  file: File
  url: string
}

/** DataTransfer（ドロップ / クリップボード共通）から対応画像だけ取り出す。 */
function imageFilesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  // items 経由（クリップボード画像は files に載らないブラウザがあるため優先）。
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) out.push(file)
    }
  }
  if (out.length === 0) {
    for (const file of Array.from(dt.files ?? [])) {
      if (file.type.startsWith('image/')) out.push(file)
    }
  }
  return out
}

export function ScreenshotUpload() {
  const navigate = useNavigate()
  const { clearSession } = useAuth()
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 単調増加 id（key の一意性を保証。同一ファイル再選択でも別項目になる）。
  const nextId = useRef(0)
  // 最新 items を副作用（追加/削除/アンマウント時の revoke）から参照するための鏡。
  const itemsRef = useRef<UploadItem[]>([])
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  // アンマウント時に残りの object URL を破棄。
  useEffect(
    () => () => {
      for (const it of itemsRef.current) URL.revokeObjectURL(it.url)
    },
    [],
  )

  // 既存リストに追記（型フィルタ・枚数上限）。paste/drop/選択の全経路で共通。
  const addFiles = useCallback((incoming: File[]) => {
    const accepted = incoming.filter((f) => ACCEPTED_TYPES.has(f.type))
    if (accepted.length === 0) {
      if (incoming.length > 0) setError('対応する画像は PNG / JPEG / WebP です')
      return
    }
    const room = MAX_IMAGES - itemsRef.current.length
    if (room <= 0) {
      setError(OVER_LIMIT_MSG)
      return
    }
    const take = accepted.slice(0, room)
    setError(take.length < accepted.length ? OVER_LIMIT_MSG : null)
    // URL 生成は updater の外で1回だけ（StrictMode の二重呼び出しでの URL リークを避ける）。
    const created = take.map((file) => ({
      id: nextId.current++,
      file,
      url: URL.createObjectURL(file),
    }))
    setItems((prev) => [...prev, ...created])
  }, [])

  const removeItem = useCallback((id: number) => {
    setError(null)
    const target = itemsRef.current.find((it) => it.id === id)
    if (target) URL.revokeObjectURL(target.url)
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  // ページ上のどこで ⌘/Ctrl+V しても貼り付けを拾う（テキスト入力中は邪魔しない）。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      const tag = active?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) return
      const imgs = imageFilesFrom(e.clipboardData)
      if (imgs.length > 0) {
        e.preventDefault()
        addFiles(imgs)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addFiles])

  async function submit() {
    if (items.length === 0) return
    const oversize = items.find((it) => it.file.size > MAX_IMAGE_BYTES)
    if (oversize) {
      setError(`${oversize.file.name || '画像'} が 10MB を超えています`)
      return
    }
    setBusy(true)
    setError(null)
    const form = new FormData()
    for (const it of items) form.append('images', it.file)
    // 配列フィールドつき multipart は素の fetch で送る（cookie セッションを同送）。
    const result = await callApi<{ ok: boolean; runId: string }>(() =>
      fetch(`${API_BASE_URL}/api/screenshots`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      }),
    )
    setBusy(false)
    if (result.ok) {
      void navigate({ to: '/runs/$id', params: { id: result.value.runId } })
    } else if (result.error.kind === 'unauthorized') {
      clearSession()
    } else if (result.error.kind === 'network') {
      setError('アップロードリクエストに失敗しました')
    } else {
      const body = result.error.body as { error?: string } | null
      setError(body?.error ?? `アップロードに失敗しました (${result.error.status})`)
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

      {/* biome-ignore lint/a11y/noStaticElementInteractions: ドロップ受けの領域（キーボード操作はファイル選択ボタンで担保） */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          addFiles(imageFilesFrom(e.dataTransfer))
        }}
        className={`rounded-md border border-dashed p-3 transition-colors ${
          dragOver ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-600'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])])
              e.target.value = '' // 同じファイルを続けて選べるようリセット
            }}
            className="text-slate-300 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-slate-200 file:text-sm hover:file:bg-slate-600"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || items.length === 0}
            className="rounded bg-indigo-600 px-4 py-1.5 font-medium text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'アップロード中…' : '解析を開始'}
          </button>
        </div>
        <p className="mt-2 text-slate-500 text-xs">
          ⌘/Ctrl+V で貼り付け・ドラッグ&ドロップ・ファイル選択に対応（PNG / JPEG /
          WebP・各10MBまで）
        </p>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {items.map((it, i) => (
            <li
              key={it.id}
              className="relative flex w-28 flex-col gap-1 rounded border border-slate-700 bg-slate-800/50 p-1.5"
            >
              <img
                src={it.url}
                alt={it.file.name || `画像 ${i + 1}`}
                className="h-16 w-full rounded object-cover"
              />
              <span className="truncate text-slate-400 text-xs" title={it.file.name}>
                {it.file.name || `画像 ${i + 1}`}
              </span>
              <span className="text-slate-500 text-xs">
                {(it.file.size / 1024 / 1024).toFixed(1)}MB
              </span>
              <button
                type="button"
                onClick={() => removeItem(it.id)}
                aria-label={`${it.file.name || `画像 ${i + 1}`} を削除`}
                className="absolute top-0.5 right-0.5 rounded bg-slate-900/80 px-1 text-slate-300 text-xs hover:bg-red-600 hover:text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
    </div>
  )
}
