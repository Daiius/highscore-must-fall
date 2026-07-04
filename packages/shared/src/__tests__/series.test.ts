import { describe, expect, it } from 'vitest'
import { normalizeName } from '../normalize'
import { UPGRADE_SERIES_BY_NAME, UPGRADE_SERIES_KEYS, upgradeSeriesOf } from '../series'

describe('UPGRADE_SERIES_BY_NAME', () => {
  it('キーはすべて正規形（normalizeName で不変）', () => {
    for (const key of Object.keys(UPGRADE_SERIES_BY_NAME)) {
      expect(normalizeName(key)).toBe(key)
    }
  })

  it('値はすべて既知の系統キー', () => {
    for (const v of Object.values(UPGRADE_SERIES_BY_NAME)) {
      expect(UPGRADE_SERIES_KEYS).toContain(v)
    }
  })

  it('未収載の名前は unknown に落ちる', () => {
    expect(upgradeSeriesOf('ADVANCED MATERIALS LAB')).toBe('unknown')
    expect(upgradeSeriesOf('ARC FLAIL')).toBe('flail')
    expect(upgradeSeriesOf('CONTEXT SWITCH')).toBe('opportunity')
  })
})
