import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config'

const baseEnv = {
  WORKER_API_TOKEN: 'secret',
  WORKER_LLM_COMMAND: 'my-llm --schema {schema} --out {output} {images:-i } -',
} satisfies NodeJS.ProcessEnv

describe('loadConfig', () => {
  it('必須 env が揃えば既定値つきで読み込む', () => {
    const config = loadConfig(baseEnv)
    expect(config.serverUrl).toBe('http://localhost:4000')
    expect(config.pollIntervalMs).toBe(15_000)
    expect(config.llmCommand).toBe(baseEnv.WORKER_LLM_COMMAND)
  })

  it('展開できないプレースホルダがあれば起動時に落とす', () => {
    expect(() =>
      loadConfig({ ...baseEnv, WORKER_LLM_COMMAND: 'my-llm --output-last-message {message}' }),
    ).toThrow(/\{message\}/)
  })

  it('展開されない接尾辞つき（{output:file} 等）も起動時に落とす', () => {
    expect(() =>
      loadConfig({ ...baseEnv, WORKER_LLM_COMMAND: 'my-llm --out {output:file}' }),
    ).toThrow(/\{output:file\}/)
  })

  it('WORKER_API_TOKEN が無ければ落とす', () => {
    expect(() => loadConfig({ WORKER_LLM_COMMAND: baseEnv.WORKER_LLM_COMMAND })).toThrow(
      /WORKER_API_TOKEN/,
    )
  })
})
