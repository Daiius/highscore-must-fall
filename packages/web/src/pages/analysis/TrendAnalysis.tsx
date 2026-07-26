// 傾向分析タブ（prd/06 §2）。
//
// ## この画面が主張しないこと
//
// 取得数も初出日も **time-dependent exposure** であり、生き延びた結果として決まる
// （prd/06 §2.1）。したがってここに出る右上がりは「取ると伸びる」「早く取ると伸びる」の
// 根拠にならない。**方向性の主張はしない**——x 軸に注記を出して、記述であることを明示する。
// 方向性を論じるにはランドマーク分析が要り、それは n が増えてからの第2段階（prd/06 §2.6）。
//
// ## 図の作り
//
// 1 行 = 1 分類。左が `× 生存日数`、右が `× スコア`（尺度が桁違いなので二重軸にしない）。
// 平均バーにしないのは、SD が平均の 67% あって平均だけだと分散に埋もれた差を実在に見せるため。
// 点 = run、色 = スコアのランプ（記述分析のカードアクセントと共用）。

import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { type TrendAnalysis as TrendAnalysisData, UPGRADE_BRANCH_LABELS } from 'shared'
import { client } from '../../api'
import { callApi } from '../../lib/api-result'
import { useAuth } from '../../lib/auth'
import { scoreColor } from './score-ramp'

type TrendData = TrendAnalysisData & { runLimit: number }

/** x 軸に何を置くか。どちらも時間依存曝露である点は変わらない。 */
type XMode = 'count' | 'firstDay'
/** 行セット。OU を個別行として混ぜるか、通常 contract の系統だけにするか。 */
type RowMode = 'series' | 'withOu'

/** 「未取得」を散布図に置くための番兵。x 軸の左端に列として立てる。 */
const NOT_TAKEN_X = -2

interface Panel {
  key: string
  label: string
  takenRuns: number
  lowSample: boolean
  points: { x: number; days: number; score: number }[]
}

export function TrendAnalysis() {
  const { clearSession } = useAuth()
  const [data, setData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [xMode, setXMode] = useState<XMode>('count')
  const [rowMode, setRowMode] = useState<RowMode>('series')

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)
      const result = await callApi<TrendData>(() => client.api.analysis.trend.$get())
      setLoading(false)
      if (result.ok) setData(result.value)
      else if (result.error.kind === 'unauthorized') clearSession()
      else setError('傾向分析データの取得に失敗しました。時間をおいて再読み込みしてください。')
    })()
  }, [clearSession])

  if (loading) return <p className="text-slate-400 text-sm">読み込み中…</p>
  if (error) return <p className="text-rose-300 text-sm">{error}</p>
  if (!data || data.runCount === 0)
    return (
      <p className="text-slate-400 text-sm">
        確定済みのランがまだありません。インポートで確定保存すると分析できます。
      </p>
    )

  const scores = data.runMetrics.map((m) => m.finalScore)
  const scoreMin = Math.min(...scores)
  const scoreMax = Math.max(...scores)

  // OU は系統に畳まないので、通常系統の行からは opportunity を外す（個別行として別に出す）。
  const branchPanels: Panel[] = data.branches
    .filter((b) => b.branch !== 'opportunity')
    .map((b) => ({
      key: b.branch,
      label: UPGRADE_BRANCH_LABELS[b.branch],
      takenRuns: b.takenRuns,
      lowSample: b.lowSample,
      points: b.points.map((p) => ({
        x: xMode === 'count' ? p.count : (p.firstDay ?? NOT_TAKEN_X),
        days: p.daysSurvived,
        score: p.finalScore,
      })),
    }))

  const ouPanels: Panel[] = data.opportunities.map((o) => ({
    key: `ou:${o.name}`,
    label: `OU: ${o.name}`,
    takenRuns: o.takenRuns,
    lowSample: o.lowSample,
    // OU は同じ run で複数回取らないので、取得数の軸は 0/1 にしかならない。
    // どちらのモードでも「取得日（未取得は左端）」で見る。
    points: o.points.map((p) => ({
      x: p.day ?? NOT_TAKEN_X,
      days: p.daysSurvived,
      score: p.finalScore,
    })),
  }))

  const panels = rowMode === 'withOu' ? [...branchPanels, ...ouPanels] : branchPanels

  return (
    <div className="space-y-6">
      <Caveat runCount={data.runCount} runLimit={data.runLimit} />

      <div className="flex flex-wrap items-center gap-3">
        <Toggle
          options={[
            { value: 'count', label: '取得数' },
            { value: 'firstDay', label: '初出日' },
          ]}
          value={xMode}
          onChange={setXMode}
          aria-label="横軸"
        />
        <Toggle
          options={[
            { value: 'series', label: '系統のみ' },
            { value: 'withOu', label: '系統 + 個別 OU' },
          ]}
          value={rowMode}
          onChange={setRowMode}
          aria-label="行の種類"
        />
      </div>

      <div className="space-y-4">
        {panels.map((panel) => (
          <PanelRow
            key={panel.key}
            panel={panel}
            xMode={xMode}
            isOu={panel.key.startsWith('ou:')}
            lowSampleThreshold={data.lowSampleThreshold}
            scoreMin={scoreMin}
            scoreMax={scoreMax}
          />
        ))}
      </div>

      <RunMetrics data={data} scoreMin={scoreMin} scoreMax={scoreMax} />
    </div>
  )
}

/** 何を見ているのかを画面に常駐させる。ここを読まずに右上がりを因果と読まれるのが最大の事故。 */
function Caveat({ runCount, runLimit }: { runCount: number; runLimit: number }) {
  return (
    <div className="space-y-1 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs">
      <p className="font-semibold text-amber-200">これは記述であって、因果の根拠ではありません</p>
      <p className="text-slate-300">
        取得数も初出日も「生き延びた結果」として増えます（長く生きるほど取得機会が増え、
        遅い初出はその日まで生存した run にしか存在しない）。
        右上がりでも「取ると伸びる」「早く取ると伸びる」を意味しません。
      </p>
      <p className="text-slate-400">
        対象 {runCount.toLocaleString()} run（直近 {runLimit.toLocaleString()} 件まで）。
      </p>
    </div>
  )
}

function PanelRow({
  panel,
  xMode,
  isOu,
  lowSampleThreshold,
  scoreMin,
  scoreMax,
}: {
  panel: Panel
  xMode: XMode
  isOu: boolean
  lowSampleThreshold: number
  scoreMin: number
  scoreMax: number
}) {
  // OU は常に取得日軸（取得数が 0/1 にしかならないため）。
  const showsDay = isOu || xMode === 'firstDay'
  const xLabel = showsDay ? '仮取得日（未 = 未取得）' : '取得数'

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold text-slate-200 text-sm">{panel.label}</h3>
        <span className="text-slate-400 text-xs">n={panel.takenRuns}</span>
        {panel.lowSample && (
          <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-amber-200 text-xs">
            データ不足（{lowSampleThreshold} 未満）
          </span>
        )}
        <span className="ml-auto text-slate-500 text-xs">横軸: {xLabel}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <MiniScatter
          panel={panel}
          yKey="days"
          yLabel="生存日数"
          showsDay={showsDay}
          scoreMin={scoreMin}
          scoreMax={scoreMax}
        />
        <MiniScatter
          panel={panel}
          yKey="score"
          yLabel="スコア"
          showsDay={showsDay}
          scoreMin={scoreMin}
          scoreMax={scoreMax}
        />
      </div>
    </section>
  )
}

function MiniScatter({
  panel,
  yKey,
  yLabel,
  showsDay,
  scoreMin,
  scoreMax,
}: {
  panel: Panel
  yKey: 'days' | 'score'
  yLabel: string
  showsDay: boolean
  scoreMin: number
  scoreMax: number
}) {
  return (
    <div className="space-y-1">
      <p className="text-slate-400 text-xs">× {yLabel}</p>
      <ResponsiveContainer width="100%" height={160}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            type="number"
            dataKey="x"
            domain={showsDay ? [NOT_TAKEN_X, 'dataMax'] : [0, 'dataMax']}
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            tickFormatter={(v: number) => (v === NOT_TAKEN_X ? '未' : String(Math.round(v)))}
          />
          <YAxis
            type="number"
            dataKey={yKey}
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            tickFormatter={(v: number) =>
              yKey === 'score' ? `${Math.round(v / 1000)}k` : String(v)
            }
          />
          <ZAxis range={[36, 36]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: '#475569' }}
            content={({ active, payload }) => {
              const point = active ? payload?.[0]?.payload : undefined
              if (!point) return null
              return (
                <div className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs">
                  <p className="text-slate-200">
                    {showsDay
                      ? point.x === NOT_TAKEN_X
                        ? '未取得'
                        : `${point.x.toFixed(1)} 日目`
                      : `${point.x} 個`}
                  </p>
                  <p className="text-slate-400">生存 {point.days} 日</p>
                  <p className="text-slate-400">スコア {point.score.toLocaleString()}</p>
                </div>
              )
            }}
          />
          <Scatter data={panel.points} isAnimationActive={false}>
            {panel.points.map((p) => (
              <Cell
                key={`${p.x}:${p.days}:${p.score}`}
                fill={scoreColor(p.score, scoreMin, scoreMax)}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

function RunMetrics({
  data,
  scoreMin,
  scoreMax,
}: {
  data: TrendData
  scoreMin: number
  scoreMax: number
}) {
  const panels: { key: string; label: string; points: Panel['points'] }[] = [
    {
      key: 'reroll',
      label: 'リロール率（回 / 取得機会）',
      points: data.runMetrics.map((m) => ({
        x: m.rerollRate,
        days: m.daysSurvived,
        score: m.finalScore,
      })),
    },
    {
      key: 'nukes',
      label: '核発射数 / 日',
      points: data.runMetrics.map((m) => ({
        x: m.nukesPerDay,
        days: m.daysSurvived,
        score: m.finalScore,
      })),
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-slate-200 text-sm">run 単位の指標</h2>
        <p className="text-slate-400 text-xs">
          行動の指標なので率にしてある（生の回数は「長く生きたから多い」を測ってしまう）。
        </p>
      </div>
      {panels.map((p) => (
        <PanelRow
          key={p.key}
          panel={{
            key: p.key,
            label: p.label,
            takenRuns: data.runCount,
            lowSample: false,
            points: p.points,
          }}
          xMode="count"
          isOu={false}
          lowSampleThreshold={data.lowSampleThreshold}
          scoreMin={scoreMin}
          scoreMax={scoreMax}
        />
      ))}
    </div>
  )
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  'aria-label': string
}) {
  return (
    <fieldset
      className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={
            value === option.value
              ? 'rounded-md bg-indigo-600 px-3 py-1 font-medium text-white text-xs'
              : 'rounded-md px-3 py-1 text-slate-400 text-xs hover:text-slate-200'
          }
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}
