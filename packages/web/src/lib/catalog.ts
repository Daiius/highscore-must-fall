// カタログ（グローバル・数百件程度）を 1 度だけ取得し、「もしかしてこれ？」の提案先として使う。
//
// 提案先は **verified な名前だけ**に絞る。unverified は誤読がそのまま自動登録された可能性のある名前で、
// 誤読 → 別の誤読を提案しても意味がないため（.claude/rules/database.md §カタログ）。

import { useEffect, useState } from 'react'
import { client } from '../api'
import { callApi } from './api-result'

interface CatalogResponse {
  upgrades: { displayName: string; verified: boolean }[]
  rewards: { displayName: string; verified: boolean }[]
}

export interface VerifiedCatalog {
  upgrades: string[]
  rewards: string[]
}

/** verified なカタログ名。取得前・失敗時は null（提案を出さないだけで、他の機能は動く）。 */
export function useVerifiedCatalog(): VerifiedCatalog | null {
  const [catalog, setCatalog] = useState<VerifiedCatalog | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await callApi<CatalogResponse>(() => client.api.catalog.$get())
      // 失敗しても何もしない（提案が出ないだけで、他の機能は動く）。
      if (cancelled || !result.ok) return
      setCatalog({
        upgrades: result.value.upgrades.filter((u) => u.verified).map((u) => u.displayName),
        rewards: result.value.rewards.filter((r) => r.verified).map((r) => r.displayName),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return catalog
}
