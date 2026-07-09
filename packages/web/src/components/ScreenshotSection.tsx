// run のスクリーンショット一覧。表示モードではグリッド、編集モードでは 1 列（右の固定カラムに入る）。
// 実体は認証エンドポイント経由で配信する（直リンク不可。prd/04 §7）。

import { API_BASE_URL } from '../api'
import { type RunDetailData, SECTION_LABELS } from '../lib/run-types'

export function ScreenshotSection({
  run,
  column = false,
}: {
  run: RunDetailData
  /** true で 1 列表示（編集中に原本を見ながら直すための固定カラム）。 */
  column?: boolean
}) {
  if (run.images.length === 0) return null
  return (
    <section className="space-y-3">
      <h2
        className={column ? 'font-semibold text-slate-200 text-sm' : 'font-semibold text-slate-200'}
      >
        スクリーンショット
      </h2>
      <div
        className={
          column
            ? 'max-h-[80vh] space-y-3 overflow-y-auto'
            : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
        }
      >
        {run.images.map((image) => {
          const src = `${API_BASE_URL}/api/runs/${run.id}/images/${image.id}`
          return (
            <figure
              key={image.id}
              className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50"
            >
              <a href={src} target="_blank" rel="noreferrer">
                <img
                  src={src}
                  alt={SECTION_LABELS[image.section]}
                  loading="lazy"
                  width={image.width ?? undefined}
                  height={image.height ?? undefined}
                  className="h-auto w-full"
                />
              </a>
              <figcaption className="px-3 py-1.5 text-slate-400 text-xs">
                {SECTION_LABELS[image.section]}（クリックで原寸）
              </figcaption>
            </figure>
          )
        })}
      </div>
    </section>
  )
}
