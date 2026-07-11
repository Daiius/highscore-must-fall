// 「もしかしてこれ？」の候補表示。読み取りミス疑いの名前に、近いカタログ名を並べる。
//
// 候補には未検証のものも混ざる（候補プール＝全カタログ名。prd/08 §9.1）。未検証の候補には
// バッジを添えて、「実在が裏取りされた名前」と「誰かの投入で自動登録されただけの名前」を
// 区別できるようにする（選ぶのは人）。
//
// 表示モード（draft / confirmed とも）でも出す。編集画面でだけ提案すると、せっかく気づける機会を
// 逃すため。編集中は onApply を渡してクリックで入力欄へ差し込めるようにする。

import type { CatalogSuggestion } from '../lib/catalog'

export function SuggestHint({
  suggestions,
  onApply,
}: {
  suggestions: CatalogSuggestion[]
  /** 渡すとクリックで適用できる（編集中のみ）。省略すると読み取り専用の表示。 */
  onApply?: (name: string) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-2 text-amber-300/80 text-xs">
      <span>もしかして:</span>
      {suggestions.map((s) => (
        <span key={s.name} className="flex items-center gap-1">
          {onApply ? (
            <button
              type="button"
              onClick={() => onApply(s.name)}
              className="rounded border border-amber-500/40 px-1.5 py-0.5 font-mono hover:bg-amber-500/20"
            >
              {s.name}
            </button>
          ) : (
            <span className="font-mono">{s.name}</span>
          )}
          {/* homoglyph（0↔O 等）一致は確度が高いので区別できるようにする。 */}
          {s.homoglyph && <span className="text-amber-300/50">（文字の取り違え）</span>}
          {/* 候補自体が未検証＝他の投入で自動登録されただけの名前。乗り換え先として弱い。 */}
          {!s.verified && (
            <span
              className="text-amber-300/50"
              title="この候補もカタログ未検証です（別の投入で自動登録された名前）。"
            >
              （未検証）
            </span>
          )}
        </span>
      ))}
    </p>
  )
}
