// draft の手動修正フォーム。読み取りミス（近い名前の取り違え・行の欠落・週の割り当てミス）を人手で直す。
// 保存は PUT /api/runs/:id/record で record を丸ごと置き換える（server が shared の contract で再検証）。
//
// 画面遷移をせず、詳細ページの同じ位置・同じ並びのまま各行を入力欄にする
// （スクショは呼び出し側が右の固定カラムに置く）。行ごとに:
//   - 未検証 / OU バッジを出す（名前を変えるまでは元のカタログエントリの属性が有効）。
//   - 変更した行にだけ「元: <値>」と「戻す」を出す。1 字違いを直すつもりで消してしまっても復帰できる。
//   - カタログに近い名前があれば「もしかして」を出す。入力中の値に対して都度計算するので、
//     手で打ち間違えた場合もその場で気づける。クリックで入力欄へ差し込む。

import { useState } from 'react'
import { client } from '../api'
import { callApi } from '../lib/api-result'
import { useAuth } from '../lib/auth'
import { type Catalog, type CatalogSuggestion, suggestFromCatalog } from '../lib/catalog'
import {
  buildRecord,
  type EditorState,
  editorStateFromRun,
  type HistoryRow,
  historyNamePristine,
  historyRowChanged,
  moveHistoryRow,
  newRowKey,
  RESULT_FIELDS,
  type RewardRow,
  revertHistoryRow,
  revertRewardRow,
  rewardNamePristine,
  rewardRowChanged,
  sumPoints,
} from '../lib/run-record'
import type { Issue, RunDetailData } from '../lib/run-types'
import { CatalogBadges } from './CatalogBadges'
import { SuggestHint } from './SuggestHint'

const INPUT_CLASS =
  'rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200 text-sm focus:border-indigo-500 focus:outline-none'

const NO_SUGGESTIONS: CatalogSuggestion[] = []

export function RunEditor({
  run,
  catalog,
  onCancel,
  onSaved,
}: {
  run: RunDetailData
  /** 提案先のカタログ名（未検証も含む全件）。取得前は null（提案を出さないだけ）。 */
  catalog: Catalog | null
  onCancel: () => void
  /** 保存成功。warning（要確認）が残ることがあるので呼び出し側へ渡す。 */
  onSaved: (issues: Issue[]) => void
}) {
  const { clearSession } = useAuth()
  const [state, setState] = useState<EditorState>(() => editorStateFromRun(run))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])

  // 入力のたびに全行 × カタログ全件を舐める計算。メモ化は React Compiler に任せる
  // （手書きの useMemo は置かない。.claude/rules/react.md）。
  const historySuggestions = new Map<string, CatalogSuggestion[]>()
  const rewardSuggestions = new Map<string, CatalogSuggestion[]>()
  if (catalog) {
    for (const row of state.history) {
      // reroll の flavor はカタログ対象外。
      if (row.type === 'upgrade') {
        historySuggestions.set(row.key, suggestFromCatalog(row.name, catalog.upgrades))
      }
    }
    for (const row of state.rewards) {
      rewardSuggestions.set(row.key, suggestFromCatalog(row.name, catalog.rewards))
    }
  }

  const pointsSum = sumPoints(state.rewards)
  const bonus = Number(state.result.apocalypse_bonus) || 0
  const bonusMismatch = pointsSum !== bonus

  async function save() {
    setBusy(true)
    setError(null)
    setIssues([])
    const result = await callApi<{ ok: boolean; issues?: Issue[] }>(() =>
      client.api.runs[':id'].record.$put({
        param: { id: run.id },
        json: { record: buildRecord(run, state) },
      }),
    )
    // onSaved は親がこのコンポーネントを畳むので、後始末（setBusy(false)）の後に呼ぶ。
    setBusy(false)
    if (result.ok) {
      onSaved(result.value.issues ?? [])
    } else if (result.error.kind === 'network') {
      setError('リクエストに失敗しました')
    } else if (result.error.kind === 'unauthorized') {
      // 他の画面と同じくセッションを落とす。エラー文だけ出すとログイン導線に戻れない。
      clearSession()
    } else {
      // 422（contract 違反）は issues、409（draft でない / 解析中）は error を返す。
      const body = result.error.body as { issues?: Issue[]; error?: string } | null
      setIssues(body?.issues ?? [])
      setError(body?.error ?? '保存できませんでした。検証エラーを確認してください。')
    }
  }

  const patchHistory = (key: string, patch: Partial<HistoryRow>) =>
    setState((s) => ({
      ...s,
      history: s.history.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }))
  const patchReward = (key: string, patch: Partial<RewardRow>) =>
    setState((s) => ({
      ...s,
      rewards: s.rewards.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }))

  const moveHistory = (index: number, delta: number) =>
    setState((s) => ({ ...s, history: moveHistoryRow(s.history, index, delta) }))

  const actions = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        保存する
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded border border-slate-600 px-3 py-1.5 font-medium text-slate-200 text-sm hover:bg-slate-700 disabled:opacity-50"
      >
        キャンセル
      </button>
    </div>
  )

  return (
    <div className="space-y-6">
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {issues.length > 0 && <IssueList issues={issues} />}

      <section className="space-y-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {RESULT_FIELDS.map(({ field, label }) => (
            <div key={field} className="space-y-1">
              <label className="block text-slate-400 text-xs" htmlFor={`result-${field}`}>
                {label}
              </label>
              <input
                id={`result-${field}`}
                type="number"
                min={0}
                value={state.result[field]}
                onChange={(e) =>
                  setState((s) => ({ ...s, result: { ...s.result, [field]: e.target.value } }))
                }
                className={`w-full font-mono ${INPUT_CLASS}`}
              />
            </div>
          ))}
        </div>
        <p className={bonusMismatch ? 'text-amber-300 text-xs' : 'text-slate-500 text-xs'}>
          REWARD LEDGER の points 合計: {pointsSum.toLocaleString()}
          {bonusMismatch
            ? ` / ボーナス ${bonus.toLocaleString()}（差 ${(pointsSum - bonus).toLocaleString()}）— 行の抜けや誤読の可能性`
            : ' — ボーナスと一致'}
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-200">UPGRADE HISTORY</h2>
          <button
            type="button"
            onClick={() =>
              setState((s) => ({
                ...s,
                history: [
                  ...s.history,
                  {
                    key: newRowKey(),
                    // 直前の行と同じ週から書き始めるほうが打鍵が減る。
                    week: s.history.at(-1)?.week ?? '1',
                    type: 'upgrade',
                    name: '',
                    flavor: '',
                    origin: null,
                  },
                ],
              }))
            }
            className="rounded border border-slate-600 px-2 py-1 text-slate-300 text-xs hover:bg-slate-700"
          >
            行を追加
          </button>
        </div>
        <p className="text-slate-500 text-xs">
          並びがそのまま取得順になります（週内の連番は保存時に振り直されます）。
        </p>
        <ol className="space-y-2">
          {state.history.map((row, index) => (
            <li key={row.key} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  aria-label="週"
                  value={row.week}
                  onChange={(e) => patchHistory(row.key, { week: e.target.value })}
                  className={`w-16 font-mono ${INPUT_CLASS}`}
                />
                <select
                  aria-label="種別"
                  value={row.type}
                  onChange={(e) =>
                    patchHistory(row.key, { type: e.target.value as HistoryRow['type'] })
                  }
                  className={INPUT_CLASS}
                >
                  <option value="upgrade">upgrade</option>
                  <option value="reroll">reroll</option>
                </select>
                {row.type === 'upgrade' ? (
                  <input
                    aria-label="アップグレード名"
                    value={row.name}
                    onChange={(e) => patchHistory(row.key, { name: e.target.value })}
                    // 空にしても元の名前が薄く残るようにする（1 字違いの直し中の消失対策）。
                    placeholder={row.origin?.name || 'NUCLEAR WEAPONS LAB'}
                    spellCheck={false}
                    className={`min-w-0 flex-1 ${INPUT_CLASS}`}
                  />
                ) : (
                  <input
                    aria-label="リロールのフレーバー"
                    value={row.flavor}
                    onChange={(e) => patchHistory(row.key, { flavor: e.target.value })}
                    placeholder={row.origin?.flavor || 'DIGITIZE CONSCIOUSNESS（任意）'}
                    spellCheck={false}
                    className={`min-w-0 flex-1 text-slate-400 italic ${INPUT_CLASS}`}
                  />
                )}
                {historyNamePristine(row) && (
                  <CatalogBadges kind={row.origin?.kind} verified={row.origin?.verified ?? null} />
                )}
                <RowButtons
                  onUp={() => moveHistory(index, -1)}
                  onDown={() => moveHistory(index, 1)}
                  onRemove={() =>
                    setState((s) => ({
                      ...s,
                      history: s.history.filter((r) => r.key !== row.key),
                    }))
                  }
                />
              </div>
              {historyRowChanged(row) && row.origin && (
                <OriginHint
                  text={`WEEK ${row.origin.week} / ${row.origin.type} / ${
                    row.origin.type === 'upgrade'
                      ? row.origin.name
                      : row.origin.flavor || '（無し）'
                  }`}
                  onRevert={() => patchHistory(row.key, revertHistoryRow(row))}
                />
              )}
              <SuggestHint
                suggestions={historySuggestions.get(row.key) ?? NO_SUGGESTIONS}
                onApply={(name) => patchHistory(row.key, { name })}
              />
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-200">REWARD LEDGER</h2>
          <button
            type="button"
            onClick={() =>
              setState((s) => ({
                ...s,
                rewards: [
                  ...s.rewards,
                  { key: newRowKey(), name: '', count: '', points: '', origin: null },
                ],
              }))
            }
            className="rounded border border-slate-600 px-2 py-1 text-slate-300 text-xs hover:bg-slate-700"
          >
            行を追加
          </button>
        </div>
        <ul className="space-y-2">
          {state.rewards.map((row) => (
            <li key={row.key} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="報酬名"
                  value={row.name}
                  onChange={(e) => patchReward(row.key, { name: e.target.value })}
                  placeholder={row.origin?.name || 'BOHEMIAN'}
                  spellCheck={false}
                  className={`min-w-0 flex-1 ${INPUT_CLASS}`}
                />
                {rewardNamePristine(row) && (
                  <CatalogBadges verified={row.origin?.verified ?? null} />
                )}
                <input
                  type="number"
                  min={0}
                  aria-label="回数"
                  value={row.count}
                  onChange={(e) => patchReward(row.key, { count: e.target.value })}
                  className={`w-20 font-mono ${INPUT_CLASS}`}
                />
                <input
                  type="number"
                  min={0}
                  aria-label="ポイント"
                  value={row.points}
                  onChange={(e) => patchReward(row.key, { points: e.target.value })}
                  className={`w-24 font-mono ${INPUT_CLASS}`}
                />
                <button
                  type="button"
                  aria-label="行を削除"
                  onClick={() =>
                    setState((s) => ({ ...s, rewards: s.rewards.filter((r) => r.key !== row.key) }))
                  }
                  className="rounded border border-slate-600 px-2 py-1 text-red-400 text-xs hover:bg-slate-700"
                >
                  ✕
                </button>
              </div>
              {rewardRowChanged(row) && row.origin && (
                <OriginHint
                  text={`${row.origin.name} ×${row.origin.count} / ${row.origin.points} pt`}
                  onRevert={() => patchReward(row.key, revertRewardRow(row))}
                />
              )}
              <SuggestHint
                suggestions={rewardSuggestions.get(row.key) ?? NO_SUGGESTIONS}
                onApply={(name) => patchReward(row.key, { name })}
              />
            </li>
          ))}
        </ul>
      </section>

      {actions}
    </div>
  )
}

/** 変更した行にだけ出す「元の値」＋戻す。消してしまった名前を思い出せるようにするのが目的。 */
function OriginHint({ text, onRevert }: { text: string; onRevert: () => void }) {
  return (
    <p className="flex items-center gap-2 pl-2 text-slate-500 text-xs">
      <span className="font-mono">元: {text}</span>
      <button type="button" onClick={onRevert} className="text-indigo-400 hover:underline">
        戻す
      </button>
    </p>
  )
}

function RowButtons({
  onUp,
  onDown,
  onRemove,
}: {
  onUp: () => void
  onDown: () => void
  onRemove: () => void
}) {
  const cls = 'rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700'
  return (
    <div className="flex gap-1">
      <button
        type="button"
        aria-label="上へ移動"
        onClick={onUp}
        className={`${cls} text-slate-300`}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="下へ移動"
        onClick={onDown}
        className={`${cls} text-slate-300`}
      >
        ↓
      </button>
      <button
        type="button"
        aria-label="行を削除"
        onClick={onRemove}
        className={`${cls} text-red-400`}
      >
        ✕
      </button>
    </div>
  )
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
      <h3 className="mb-2 font-semibold text-slate-200 text-sm">検証結果</h3>
      <ul className="space-y-1">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${i}`} className="text-slate-300 text-sm">
            <span className={issue.level === 'error' ? 'text-red-400' : 'text-amber-300'}>
              [{issue.level}]
            </span>{' '}
            <span className="text-slate-500">{issue.path.join('.') || '—'}: </span>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
