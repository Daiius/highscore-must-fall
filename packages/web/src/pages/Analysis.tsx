// /analysis のタブ shell（prd/06）。
//   記述分析（§1）… 眺めるための図。run の構成を俯瞰する。
//   傾向分析（§2）… 傾向を探すための図。系統・OU・run 単位指標を散布で見る。
// 目的も粒度も違うので別タブにし、入口だけ 1 つに保つ。

import { useState } from 'react'
import { DescriptiveAnalysis } from './analysis/DescriptiveAnalysis'
import { TrendAnalysis } from './analysis/TrendAnalysis'

type Tab = 'descriptive' | 'trend'

export function Analysis() {
  const [tab, setTab] = useState<Tab>('descriptive')

  return (
    <div className="space-y-6">
      <div
        className="flex items-center gap-1 rounded-lg border border-slate-700 p-0.5"
        role="tablist"
        aria-label="分析の種類"
      >
        <TabButton
          label="記述分析"
          active={tab === 'descriptive'}
          onClick={() => setTab('descriptive')}
        />
        <TabButton label="傾向分析" active={tab === 'trend'} onClick={() => setTab('trend')} />
      </div>
      {tab === 'descriptive' ? <DescriptiveAnalysis /> : <TrendAnalysis />}
    </div>
  )
}

function TabButton({
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? 'rounded-md bg-indigo-600 px-4 py-1.5 font-medium text-sm text-white'
          : 'rounded-md px-4 py-1.5 text-slate-400 text-sm hover:text-slate-200'
      }
    >
      {label}
    </button>
  )
}
