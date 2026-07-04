// run の status（draft/confirmed）バッジ。一覧・詳細で共用。

export function StatusBadge({ status }: { status: 'draft' | 'confirmed' }) {
  return status === 'confirmed' ? (
    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300 text-xs">確定</span>
  ) : (
    <span className="rounded bg-slate-600/40 px-2 py-0.5 text-slate-300 text-xs">ドラフト</span>
  )
}
