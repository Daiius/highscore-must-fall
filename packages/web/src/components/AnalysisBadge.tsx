// スクショ自動解析のジョブ状態バッジ（prd/04 §9.5）。
// succeeded は run.status（ドラフト/確定）のバッジが結果を表すため何も出さない。

export type AnalysisStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export function AnalysisBadge({ status }: { status: AnalysisStatus | null | undefined }) {
  if (status === 'queued') {
    return <span className="rounded bg-sky-500/20 px-2 py-0.5 text-sky-300 text-xs">解析待ち</span>
  }
  if (status === 'running') {
    return (
      <span className="animate-pulse rounded bg-sky-500/20 px-2 py-0.5 text-sky-300 text-xs">
        解析中…
      </span>
    )
  }
  if (status === 'failed') {
    return <span className="rounded bg-red-500/20 px-2 py-0.5 text-red-300 text-xs">解析失敗</span>
  }
  return null
}

/** ジョブが進行中（polling を続けるべき状態）か。 */
export function isAnalysisActive(status: AnalysisStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running'
}
