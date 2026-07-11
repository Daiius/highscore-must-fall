// カタログ管理（prd/08 §6）。admin 限定。
//
// できること: 一覧・フィルタ（未検証 / 孤児 / OU）・参照数・初出 run へのリンク・**マージ**・
// **孤児削除**・seed スニペットのコピー。
//
// できないこと（意図的に作らない）:
//   - **verify**: `verified` の正典は seed。昇格は「画像を prd/samples/ にコミットして evidence を
//     書く PR」を通す（prd/08 §5）。ボタン一つで立つフラグは根拠が辿れず、レビューにも乗らない。
//   - **kind の変更**: 同上（seed が正典）。
//   - **名前の直接編集**: 訂正は**マージで表現する**。旧名を alias に残さないと、同じ誤読を含む
//     過去/未来の投入が名寄せできなくなる。
//
// この画面の役目は、誤読の残骸を掃除することと、**seed に足す PR を書くための材料を出すこと**。

import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { attempt } from '../lib/api-result'
import { useAuth } from '../lib/auth'
import {
  type CatalogFilter,
  type CatalogKind,
  deleteOrphan,
  fetchManagedCatalog,
  filterRows,
  type ManagedCatalog,
  type ManagedCatalogRow,
  mergeCandidates,
  mergeCatalogEntry,
  mutationErrorMessage,
  seedSnippet,
} from '../lib/catalog-admin'

const FILTERS: { value: CatalogFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'unverified', label: '未検証' },
  { value: 'orphan', label: '孤児' },
  { value: 'ou', label: 'OU' },
]

export function Catalog() {
  const { user, clearSession } = useAuth()
  const [data, setData] = useState<ManagedCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<CatalogKind>('upgrade')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  /** 実行中の行 id（多重送信の抑止）。 */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** マージ操作を開いている行 id と、選択中の統合先。 */
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string>('')

  // メモ化は React Compiler に任せる（useCallback を書かない。.claude/rules/react.md）。
  const load = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    const result = await fetchManagedCatalog()
    if (!options?.silent) setLoading(false)
    if (result.ok) {
      setData(result.value)
      setError(null)
    } else if (result.error.kind === 'unauthorized') {
      clearSession()
    } else if (result.error.kind === 'status' && result.error.status === 403) {
      setError('カタログ管理は管理者のみが使えます。')
    } else {
      setError('カタログの取得に失敗しました。')
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  if (user && user.role !== 'admin') {
    return <p className="text-slate-400 text-sm">カタログ管理は管理者のみが使えます。</p>
  }
  if (loading) return <p className="text-slate-400">読み込み中…</p>
  if (error) return <p className="text-red-400 text-sm">{error}</p>
  if (!data) return null

  const rows = filterRows(kind === 'upgrade' ? data.upgrades : data.rewards, filter)
  const all = kind === 'upgrade' ? data.upgrades : data.rewards
  const orphanCount = all.filter((r) => r.orphan).length

  async function runMerge(source: ManagedCatalogRow, targetId: string) {
    const target = all.find((r) => r.id === targetId)
    if (!target) return
    const ok = window.confirm(
      `「${source.displayName}」を「${target.displayName}」に統合します。\n` +
        `参照している ${source.refCount} 件のエントリが付け替わり、旧名は別名として残ります。\n` +
        'この操作は取り消せません。',
    )
    if (!ok) return
    setBusyId(source.id)
    const result = await mergeCatalogEntry(kind, source.id, targetId)
    setBusyId(null)
    if (result.ok) {
      setMergeSourceId(null)
      setMergeTargetId('')
      setNotice(
        `「${source.displayName}」を「${target.displayName}」に統合しました` +
          `（エントリ ${result.value.mergedEntries} 件を付け替え）。`,
      )
      await load({ silent: true })
    } else if (result.error.kind === 'unauthorized') {
      clearSession()
    } else if (result.error.kind === 'status') {
      setError(mutationErrorMessage(result.error.body))
    } else {
      setError('統合に失敗しました。')
    }
  }

  async function runDelete(row: ManagedCatalogRow) {
    const ok = window.confirm(
      `孤児「${row.displayName}」を削除します。\n` +
        '参照ゼロ・別名なし・seed 外・未検証の行のみが対象です。この操作は取り消せません。',
    )
    if (!ok) return
    setBusyId(row.id)
    const result = await deleteOrphan(kind, row.id)
    setBusyId(null)
    if (result.ok) {
      setNotice(`孤児「${row.displayName}」を削除しました。`)
      await load({ silent: true })
    } else if (result.error.kind === 'unauthorized') {
      clearSession()
    } else if (result.error.kind === 'status') {
      setError(mutationErrorMessage(result.error.body))
      await load({ silent: true }) // 一覧が古い可能性（押すまでの間に参照が付いた等）。
    } else {
      setError('削除に失敗しました。')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-bold text-white text-xl">カタログ管理</h1>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5">
          <Toggle
            label="アップグレード"
            active={kind === 'upgrade'}
            onClick={() => {
              setKind('upgrade')
              setMergeSourceId(null)
            }}
          />
          <Toggle
            label="リワード"
            active={kind === 'reward'}
            onClick={() => {
              setKind('reward')
              setMergeSourceId(null)
              if (filter === 'ou') setFilter('all')
            }}
          />
        </div>
      </div>

      <p className="text-slate-500 text-xs">
        「未検証」を verify するボタンはここには無い。裏取りは
        <code className="px-1 font-mono">prd/samples/</code>
        に画像をコミットして seed に <code className="px-1 font-mono">evidence</code> を書く PR
        で行う（根拠がレビューに乗らないフラグは意味を持たないため）。この画面でできるのは、誤読の
        残骸を掃除すること（統合・孤児削除）と、その PR を書くための seed スニペットを出すこと。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5">
          {FILTERS.filter((f) => f.value !== 'ou' || kind === 'upgrade').map((f) => (
            <Toggle
              key={f.value}
              label={f.label}
              active={filter === f.value}
              onClick={() => setFilter(f.value)}
            />
          ))}
        </div>
        <span className="text-slate-500 text-xs">
          {rows.length} / {all.length} 件（孤児 {orphanCount} 件）
        </span>
      </div>

      {notice && (
        <p className="rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-emerald-300 text-sm">
          {notice}
        </p>
      )}

      <div className="divide-y divide-slate-800 rounded-lg border border-slate-700 bg-slate-800/30">
        {rows.length === 0 && (
          <p className="p-4 text-slate-500 text-sm">該当するエントリはありません。</p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-sm text-white">{row.displayName}</span>
              {row.verified ? (
                <Badge tone="emerald">検証済み</Badge>
              ) : (
                <Badge tone="amber">未検証</Badge>
              )}
              {row.kind === 'opportunity_upgrade' && <Badge tone="slate">OU</Badge>}
              {row.inSeed && <Badge tone="slate">seed</Badge>}
              {row.orphan && <Badge tone="red">孤児</Badge>}
              <span className="text-slate-500 text-xs">参照 {row.refCount} 件</span>
              {row.firstSeenRunId && (
                <Link
                  to="/runs/$id"
                  params={{ id: row.firstSeenRunId }}
                  className="text-indigo-400 text-xs hover:underline"
                >
                  初出 run
                </Link>
              )}
              {row.aliases.length > 0 && (
                <span className="text-slate-500 text-xs">別名: {row.aliases.join(', ')}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SmallButton
                onClick={() => {
                  setMergeSourceId(mergeSourceId === row.id ? null : row.id)
                  setMergeTargetId('')
                }}
                disabled={row.inSeed || row.verified || busyId !== null}
                title={
                  row.inSeed || row.verified
                    ? 'seed / 検証済みの名前は統合元にできません（再 seed で復活するため）'
                    : undefined
                }
              >
                統合…
              </SmallButton>
              <SmallButton
                onClick={() => void runDelete(row)}
                disabled={!row.orphan || busyId !== null}
                tone="danger"
                title={
                  !row.orphan
                    ? '孤児（参照ゼロ・別名なし・seed 外・未検証）のみ削除できます'
                    : undefined
                }
              >
                孤児削除
              </SmallButton>
              <SmallButton
                onClick={() => {
                  void attempt(() => navigator.clipboard.writeText(seedSnippet(row))).then((ok) =>
                    setNotice(
                      ok
                        ? `seed スニペットをコピーしました: ${seedSnippet(row)}`
                        : 'クリップボードにコピーできませんでした',
                    ),
                  )
                }}
              >
                seed スニペット
              </SmallButton>
            </div>

            {mergeSourceId === row.id && (
              <div className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900/50 p-2">
                <span className="text-slate-400 text-xs">統合先:</span>
                <MergeTargetSelect
                  row={row}
                  rows={all}
                  value={mergeTargetId}
                  onChange={setMergeTargetId}
                />
                <SmallButton
                  onClick={() => void runMerge(row, mergeTargetId)}
                  disabled={mergeTargetId === '' || busyId !== null}
                >
                  統合する
                </SmallButton>
                <span className="text-slate-500 text-xs">
                  旧名「{row.displayName}」は別名として残り、以後の投入も統合先に名寄せされます。
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 統合先の選択。**似た名前（誤読の統合先になりやすい）を先頭グループに出す**。
 * 候補が出ないケース（綴りが大きく違う）もあるので、全カタログ名も選べるようにする。
 */
function MergeTargetSelect({
  row,
  rows,
  value,
  onChange,
}: {
  row: ManagedCatalogRow
  rows: ManagedCatalogRow[]
  value: string
  onChange: (id: string) => void
}) {
  const byName = new Map(rows.map((r) => [r.displayName, r]))
  const candidates = mergeCandidates(row, rows).flatMap((name) => {
    const found = byName.get(name)
    return found ? [found] : []
  })
  const candidateIds = new Set(candidates.map((r) => r.id))
  const others = rows.filter((r) => r.id !== row.id && !candidateIds.has(r.id))
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="統合先"
      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono text-slate-100 text-sm"
    >
      <option value="">選択してください</option>
      {candidates.length > 0 && (
        <optgroup label="似た名前">
          {candidates.map((r) => (
            <option key={r.id} value={r.id}>
              {r.displayName}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="すべて">
        {others.map((r) => (
          <option key={r.id} value={r.id}>
            {r.displayName}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded-md bg-indigo-600 px-3 py-1 font-medium text-white text-xs'
          : 'rounded-md px-3 py-1 text-slate-400 text-xs hover:text-slate-200'
      }
    >
      {label}
    </button>
  )
}

function SmallButton({
  children,
  onClick,
  disabled,
  tone,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'danger'
  title?: string
}) {
  const base =
    'rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
  const color =
    tone === 'danger'
      ? 'border-red-700/60 text-red-300 hover:bg-red-900/30'
      : 'border-slate-600 text-slate-300 hover:bg-slate-700'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${color}`}
    >
      {children}
    </button>
  )
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'emerald' | 'amber' | 'slate' | 'red'
}) {
  const colors = {
    emerald: 'border-emerald-700/60 text-emerald-300',
    amber: 'border-amber-600/60 text-amber-300',
    slate: 'border-slate-600 text-slate-400',
    red: 'border-red-700/60 text-red-300',
  } as const
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${colors[tone]}`}>{children}</span>
  )
}
