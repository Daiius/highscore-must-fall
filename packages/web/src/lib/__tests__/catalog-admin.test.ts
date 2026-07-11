import { describe, expect, it } from 'vitest'
import {
  type CatalogFilter,
  filterRows,
  type ManagedCatalogRow,
  mergeCandidates,
  seedSnippet,
} from '../catalog-admin'

const row = (over: Partial<ManagedCatalogRow>): ManagedCatalogRow => ({
  id: over.displayName ?? 'id',
  canonicalKey: over.displayName ?? 'X',
  displayName: 'X',
  kind: 'contract',
  verified: false,
  firstSeenRunId: null,
  refCount: 0,
  aliases: [],
  inSeed: false,
  orphan: false,
  ...over,
})

const ROWS = [
  row({ displayName: 'TWIN DRONE FACTORY', verified: true, inSeed: true, refCount: 3 }),
  row({ displayName: 'THIN DRONE FACTORY', orphan: true }), // 誤読の残骸
  row({ displayName: 'CONTEXT SWITCH', kind: 'opportunity_upgrade', verified: true, inSeed: true }),
]

describe('filterRows', () => {
  const names = (f: CatalogFilter) => filterRows(ROWS, f).map((r) => r.displayName)

  it('未検証・孤児・OU で絞れる', () => {
    expect(names('all')).toHaveLength(3)
    expect(names('unverified')).toEqual(['THIN DRONE FACTORY'])
    expect(names('orphan')).toEqual(['THIN DRONE FACTORY'])
    expect(names('ou')).toEqual(['CONTEXT SWITCH'])
  })
})

describe('mergeCandidates', () => {
  it('誤読名に対して、似た名前を統合先候補として出す', () => {
    const source = ROWS[1] as ManagedCatalogRow
    expect(mergeCandidates(source, ROWS)).toContain('TWIN DRONE FACTORY')
  })

  it('自分自身は候補に出さない', () => {
    const source = ROWS[1] as ManagedCatalogRow
    expect(mergeCandidates(source, ROWS)).not.toContain('THIN DRONE FACTORY')
  })
})

describe('seedSnippet', () => {
  it('evidence: null の行として貼れる（開発者が画像名を埋めて PR にする）', () => {
    expect(seedSnippet(row({ displayName: 'PULSE REFLEX' }))).toBe(
      "{ name: 'PULSE REFLEX', evidence: null },",
    )
  })

  it('OU は kind を添える（seed が kind の正典なので落とさない）', () => {
    expect(seedSnippet(row({ displayName: 'PIVOT RELOAD', kind: 'opportunity_upgrade' }))).toBe(
      "{ name: 'PIVOT RELOAD', kind: 'opportunity_upgrade', evidence: null },",
    )
  })

  it("アポストロフィを含む名前をエスケープする（CHEF'S KISS）", () => {
    expect(seedSnippet(row({ displayName: "CHEF'S KISS", kind: null }))).toBe(
      "{ name: 'CHEF\\'S KISS', evidence: null },",
    )
  })
})
