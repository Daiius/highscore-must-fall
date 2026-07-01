import { describe, expect, it } from 'vitest'
import { RUN_RECORD_JSON_SCHEMA_ID, runRecordJsonSchema } from '../json-schema'
import { SCHEMA_VERSION } from '../version'

describe('runRecordJsonSchema', () => {
  it('object 型で主要プロパティを含む JSON Schema を導出する', () => {
    const schema = runRecordJsonSchema() as Record<string, unknown>
    expect(schema.type).toBe('object')
    const properties = schema.properties as Record<string, unknown>
    expect(properties).toHaveProperty('result')
    expect(properties).toHaveProperty('upgrade_history')
    expect(properties).toHaveProperty('reward_ledger')
  })

  it('input モードでは default 付き schema_version / game は required でない', () => {
    const schema = runRecordJsonSchema() as { required?: string[] }
    const required = schema.required ?? []
    expect(required).not.toContain('schema_version')
    expect(required).not.toContain('game')
    expect(required).toContain('result')
  })

  it('$id は現行 schema_version を含む', () => {
    expect(RUN_RECORD_JSON_SCHEMA_ID).toContain(SCHEMA_VERSION)
  })
})
