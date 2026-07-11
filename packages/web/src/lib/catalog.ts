// カタログ（グローバル・数百件程度）を 1 度だけ取得し、「もしかしてこれ？」の提案先として使う。
//
// 候補プールは **全カタログ名**（verified で絞らない。prd/08 §9.1）。verified に絞ると、ゲーム更新から
// seed が追いつくまでの期間、その期間の新要素は候補に出ず、既存の似た旧名へ誤誘導することになる。
// 未検証の候補には「未検証」バッジを添えて人が選ぶ。`verified` は表示専用の属性であり、
// 機能（投入・確定・分析・サジェスト）の前提条件にはしない。

import { useEffect, useState } from 'react'
import { type NameSuggestion, normalizeName, suggestSimilarNames } from 'shared'
import { client } from '../api'
import { callApi } from './api-result'

interface CatalogResponse {
  upgrades: { displayName: string; verified: boolean }[]
  rewards: { displayName: string; verified: boolean }[]
}

/** サジェストの候補プール（upgrade / reward の 1 種別ぶん）。 */
export interface CatalogPool {
  /** 全カタログ名（未検証も含む）。表示名＝正規形。 */
  names: string[]
  /** そのうち verified な名前（正規形）。候補のバッジと、提案の抑制に使う。 */
  verified: ReadonlySet<string>
}

export interface Catalog {
  upgrades: CatalogPool
  rewards: CatalogPool
}

/** 候補 + 「その候補自体が未検証か」。人が選ぶ材料として出す。 */
export interface CatalogSuggestion extends NameSuggestion {
  verified: boolean
}

const NO_SUGGESTIONS: CatalogSuggestion[] = []

/**
 * name に近いカタログ名を返す。**verified なカタログ名と一致する入力には出さない**
 * （実在が裏取り済み＝誤読ではないため、ノイズになる）。未検証の名前・カタログに無い名前には出す。
 *
 * これは「表示するかどうか」の抑制であって、候補プールの制限ではない。新要素は unverified 登録
 * なので抑制されず、他の未検証名（先に投入した人の正しい読み）も候補に出る。
 */
export function suggestFromCatalog(
  name: string | null,
  pool: CatalogPool | undefined,
): CatalogSuggestion[] {
  if (!pool || name === null) return NO_SUGGESTIONS
  const key = normalizeName(name)
  if (key.length === 0 || pool.verified.has(key)) return NO_SUGGESTIONS
  return suggestSimilarNames(key, pool.names).map((s) => ({
    ...s,
    verified: pool.verified.has(s.name),
  }))
}

/** カタログ名。取得前・失敗時は null（提案を出さないだけで、他の機能は動く）。 */
export function useCatalog(): Catalog | null {
  const [catalog, setCatalog] = useState<Catalog | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await callApi<CatalogResponse>(() => client.api.catalog.$get())
      // 失敗しても何もしない（提案が出ないだけで、他の機能は動く）。
      if (cancelled || !result.ok) return
      const toPool = (rows: CatalogResponse['upgrades']): CatalogPool => ({
        names: rows.map((r) => r.displayName),
        verified: new Set(rows.filter((r) => r.verified).map((r) => normalizeName(r.displayName))),
      })
      setCatalog({
        upgrades: toPool(result.value.upgrades),
        rewards: toPool(result.value.rewards),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return catalog
}
