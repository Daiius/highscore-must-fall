import { describe, expect, it } from 'vitest'
import { parseExtractionOutput } from '../output'
import { EXAMPLE_EXTRACTION } from '../prompt'

const exampleJson = JSON.stringify(EXAMPLE_EXTRACTION)

describe('parseExtractionOutput', () => {
  it('素の JSON を受理する', () => {
    const extraction = parseExtractionOutput(exampleJson)
    expect(extraction.result.final_score).toBe(143161)
    expect(extraction.images).toHaveLength(3)
  })

  it('structured_output envelope から中身を取り出す', () => {
    const extraction = parseExtractionOutput(
      JSON.stringify({ structured_output: EXAMPLE_EXTRACTION, session_id: 'x' }),
    )
    expect(extraction.upgrade_history[0]?.name).toBe('NUCLEAR WEAPONS LAB')
  })

  it('コードフェンスで包まれていても剥がして受理する', () => {
    const extraction = parseExtractionOutput(`\`\`\`json\n${exampleJson}\n\`\`\``)
    expect(extraction.reward_ledger).toHaveLength(13)
  })

  it('JSON でない出力は明示エラー', () => {
    expect(() => parseExtractionOutput('not json')).toThrow(/JSON としてパースできません/)
  })

  it('スキーマ不一致は issue つきの明示エラー', () => {
    expect(() => parseExtractionOutput('{"images": []}')).toThrow(/抽出スキーマに一致しません/)
  })
})
