import { describe, expect, it } from 'vitest'
import { type CatalogPool, suggestFromCatalog } from '../catalog'

/**
 * 候補プールは全カタログ名（未検証を含む）。verified は「実在を裏取り済み」の印で、
 * 候補プールを絞るためには使わない（prd/08 §9.1）。
 */
const POOL: CatalogPool = {
  names: ['ARC FLAIL', 'NUCLEAR WEAPONS LAB', 'ARC FLAILL', 'THIN DRONE FACTORY'],
  // 'ARC FLAILL' / 'THIN DRONE FACTORY' は投入時に自動登録された未検証の名前。
  verified: new Set(['ARC FLAIL', 'NUCLEAR WEAPONS LAB']),
}

describe('suggestFromCatalog', () => {
  it('未検証の名前には提案を出す（自分自身は候補から外れる）', () => {
    const results = suggestFromCatalog('ARC FLAILL', POOL)
    expect(results.map((r) => r.name)).toEqual(['ARC FLAIL'])
    expect(results[0]?.verified).toBe(true)
  })

  it('verified な名前と一致する入力には提案を出さない（裏取り済み＝誤読ではない）', () => {
    expect(suggestFromCatalog('ARC FLAIL', POOL)).toEqual([])
    // 入力の揺れ（大小・空白）は正規化して一致とみなす。
    expect(suggestFromCatalog(' arc  flail ', POOL)).toEqual([])
  })

  it('未検証の候補も提案する（新要素はまだ verified になれないため）', () => {
    // ゲーム更新直後、先行プレイヤーの投入で 'THIN DRONE FACTORY' が未検証登録されている状況。
    // 後続の誤読 'THIN DRONE FACTORYY' に対し、verified に絞ると何も出せない。
    const results = suggestFromCatalog('THIN DRONE FACTORYY', POOL)
    expect(results.map((r) => r.name)).toEqual(['THIN DRONE FACTORY'])
    // 候補自体が未検証であることは呼び出し側（SuggestHint）がバッジで示す。
    expect(results[0]?.verified).toBe(false)
  })

  it('カタログ未取得・名前なしは空（提案が出ないだけで他の機能は動く）', () => {
    expect(suggestFromCatalog('ARC FLAILL', undefined)).toEqual([])
    expect(suggestFromCatalog(null, POOL)).toEqual([])
    expect(suggestFromCatalog('   ', POOL)).toEqual([])
  })
})
