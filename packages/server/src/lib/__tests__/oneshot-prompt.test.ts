// 配布プロンプト（web の単一の真実）のドリフト検知（prd/04 §6）。
// EXAMPLE を実際の ingestion 検証に通し、shared スキーマ / フラット変換規約が変わったら
// このテストを落としてプロンプト更新を強制する。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ingestSubmission } from '../ingest'

const PROMPT_URL = new URL('../../../../web/src/assets/oneshot-prompt.txt', import.meta.url)

describe('oneshot-prompt.txt（配布プロンプト）', () => {
  const lines = readFileSync(PROMPT_URL, 'utf8').split('\n')
  const exampleStart = lines.findIndex((l) => /^EXAMPLE.*:\s*$/.test(l))

  it('EXAMPLE 節を持つ（切り出し規約: 「EXAMPLE…:」行の次行以降が YAML）', () => {
    expect(exampleStart).toBeGreaterThan(-1)
  })

  it('EXAMPLE は現行契約の ingestion 検証を error/warning ゼロで通る', () => {
    const yamlText = lines.slice(exampleStart + 1).join('\n')
    const result = ingestSubmission(yamlText, 'yaml')
    // 自己整合（Σpoints == apocalypse_bonus）を配布例で実演しているため warning もゼロを要求する。
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })
})
