// run 詳細 API（GET /api/runs/:id）のレスポンス型。RunDetail と RunEditor が共有する。
// server の getRunDetail が返す形に対応させること。

import type { RunRecord } from 'shared'
import type { AnalysisStatus } from '../components/AnalysisBadge'

export interface Issue {
  level: 'error' | 'warning'
  code: string
  message: string
  path: (string | number)[]
}

export interface UpgradeEntry {
  id: string
  weekIndex: number
  orderInWeek: number
  entryType: 'upgrade' | 'reroll'
  upgradeOrder: number | null
  flavorText: string | null
  name: string | null
  kind: string | null
  verified: boolean | null
}

export interface RewardEntry {
  id: string
  name: string
  verified: boolean | null
  count: number
  points: number
}

export interface RunImage {
  id: string
  section: 'result' | 'upgrade_history' | 'reward_ledger' | 'other'
  contentType: string
  byteSize: number
  width: number | null
  height: number | null
}

export interface AnalysisJobInfo {
  status: AnalysisStatus
  attemptCount: number
  lastError: string | null
  llmModel: string | null
  updatedAt: string
  /** 再解析可否（サーバ判定・正典）。lease 超過の running もここで true になる。 */
  reanalyzable: boolean
}

export interface RunDetailData {
  id: string
  game: string
  playedAt: string
  status: 'draft' | 'confirmed'
  finalScore: number | null
  daysSurvived: number | null
  aliensDefeated: number | null
  nukesLaunched: number | null
  apocalypseBonus: number | null
  rerollCount: number
  upgradeEntries: UpgradeEntry[]
  rewardEntries: RewardEntry[]
  images: RunImage[]
  analysisJob: AnalysisJobInfo | null
  /** 正規スキーマ全体（schema_version・played_at・未知キーの温存元）。手動修正の土台にする。 */
  rawPayload: RunRecord | null
  llmModel: string | null
  sourceNote: string | null
}

export const SECTION_LABELS: Record<RunImage['section'], string> = {
  result: '結果画面',
  upgrade_history: 'UPGRADE HISTORY',
  reward_ledger: 'REWARD LEDGER',
  other: '未分類',
}
