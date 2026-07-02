import { describe, expect, it } from 'vitest'
import { migrateToCurrent, SCHEMA_VERSION } from '../version'

describe('SCHEMA_VERSION', () => {
  it('semver 形式', () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('migrateToCurrent', () => {
  it('既に現行バージョンなら素通しする', () => {
    const raw = { schema_version: SCHEMA_VERSION, foo: 1 }
    expect(migrateToCurrent(raw)).toEqual(raw)
  })

  it('変換器の無い未知バージョンはエラー', () => {
    expect(() => migrateToCurrent({ schema_version: '0.0.1' })).toThrow()
  })

  it('schema_version が無ければエラー', () => {
    expect(() => migrateToCurrent({})).toThrow()
  })
})
