// カタログ由来のバッジ（OU / 未検証）。表示モードと編集モードで同じ見た目を使う。
// 未検証 = unverified 自動登録されたエントリ。読み取りミスがそのまま新規登録された疑いがある行なので、
// 編集中こそ見えている必要がある。

export function CatalogBadges({
  kind,
  verified,
}: {
  kind?: string | null
  verified: boolean | null
}) {
  return (
    <>
      {kind === 'opportunity_upgrade' && (
        <span className="ml-2 rounded bg-cyan-500/20 px-1.5 py-0.5 text-cyan-300 text-xs">OU</span>
      )}
      {verified === false && (
        <span
          className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300 text-xs"
          title="カタログに未検証で自動登録された名前です。読み取りミスの可能性があります。"
        >
          未検証
        </span>
      )}
    </>
  )
}
