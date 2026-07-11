// カタログ管理画面のデータ取得・変更（prd/08 §6）。admin 限定 API を叩く。
//
// **verify は無い**（正典は seed。昇格は画像コミット + evidence を書く PR）。`kind` 変更・
// 名前の直接編集も無い（訂正はマージで表現する）。UI がやるのは「PR を書くための材料出し」
// （seed スニペット）と、マージ・孤児削除まで。

import { suggestSimilarNames } from 'shared'
import { client } from '../api'
import { type ApiResult, callApi } from './api-result'

export type CatalogKind = 'upgrade' | 'reward'

export interface ManagedCatalogRow {
  id: string
  canonicalKey: string
  displayName: string
  kind: 'contract' | 'opportunity_upgrade' | null
  verified: boolean
  /** 初出 run。**自分の run のときだけ id が入る**（他 owner の run へは辿れない。prd/05 §2）。 */
  firstSeenRunId: string | null
  /** 初出 run が存在するか（他ユーザーの run でも true。閲覧はできない）。 */
  firstSeenRunExists: boolean
  refCount: number
  aliases: string[]
  inSeed: boolean
  orphan: boolean
}

export interface ManagedCatalog {
  upgrades: ManagedCatalogRow[]
  rewards: ManagedCatalogRow[]
}

export function fetchManagedCatalog(): Promise<ApiResult<ManagedCatalog>> {
  return callApi<ManagedCatalog>(() => client.api.catalog.manage.$get())
}

export function mergeCatalogEntry(
  kind: CatalogKind,
  sourceId: string,
  targetId: string,
): Promise<ApiResult<{ ok: true; mergedEntries: number }>> {
  return callApi(() => client.api.catalog.merge.$post({ json: { kind, sourceId, targetId } }))
}

export function deleteOrphan(kind: CatalogKind, id: string): Promise<ApiResult<{ ok: true }>> {
  return callApi(() => client.api.catalog[':kind'][':id'].$delete({ param: { kind, id } }))
}

/** server の失敗レスポンス（{ error: string }）からメッセージを取り出す。 */
export function mutationErrorMessage(body: unknown): string {
  const message = (body as { error?: unknown } | null)?.error
  return typeof message === 'string' ? message : '操作に失敗しました'
}

/** フィルタ。all=全件 / unverified=未検証 / orphan=孤児 / ou=OU（upgrade のみ）。 */
export type CatalogFilter = 'all' | 'unverified' | 'orphan' | 'ou'

export function filterRows(rows: ManagedCatalogRow[], filter: CatalogFilter): ManagedCatalogRow[] {
  switch (filter) {
    case 'unverified':
      return rows.filter((r) => !r.verified)
    case 'orphan':
      return rows.filter((r) => r.orphan)
    case 'ou':
      return rows.filter((r) => r.kind === 'opportunity_upgrade')
    default:
      return rows
  }
}

/**
 * マージ相手の候補。**同じカタログ内の似た名前**を出す（誤読 → 正しい名前への統合が主用途）。
 * 候補プールは全カタログ名（verified で絞らない。prd/08 §9.1）。
 */
export function mergeCandidates(row: ManagedCatalogRow, rows: ManagedCatalogRow[]): string[] {
  const others = rows.filter((r) => r.id !== row.id).map((r) => r.displayName)
  return suggestSimilarNames(row.displayName, others).map((s) => s.name)
}

/** seed（catalog-data.ts）へ貼るスニペット。開発者が evidence を埋めて PR にする。 */
export function seedSnippet(row: ManagedCatalogRow): string {
  const kind = row.kind === 'opportunity_upgrade' ? ` kind: 'opportunity_upgrade',` : ''
  return `{ name: '${row.displayName.replaceAll("'", "\\'")}',${kind} evidence: null },`
}
