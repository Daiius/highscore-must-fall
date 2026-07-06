import { describe, expect, it } from 'vitest'
import { renderLlmCommand, shellQuote, usesOutputFile } from '../llm-command'

const ctx = {
  schemaPath: '/tmp/work/extraction.schema.json',
  schemaJson: '{"type":"object"}',
  outputPath: '/tmp/work/extraction.json',
  imagePaths: ['/tmp/work/image-0.png', '/tmp/work/image-1.jpg'],
  model: 'some-model',
}

describe('renderLlmCommand', () => {
  it('プレースホルダをシェルクォート済みの実値へ展開する', () => {
    const command = renderLlmCommand(
      'my-llm exec --schema {schema} --out {output} --model {model}',
      ctx,
    )
    expect(command).toBe(
      "my-llm exec --schema '/tmp/work/extraction.schema.json' --out '/tmp/work/extraction.json' --model 'some-model'",
    )
  })

  it('{images:PREFIX} は各画像パスを前置詞つきで並べる', () => {
    expect(renderLlmCommand('my-llm {images:-i } -', ctx)).toBe(
      "my-llm -i '/tmp/work/image-0.png' -i '/tmp/work/image-1.jpg' -",
    )
    expect(renderLlmCommand('my-llm {images}', ctx)).toBe(
      "my-llm '/tmp/work/image-0.png' '/tmp/work/image-1.jpg'",
    )
  })

  it('{schema_inline} はスキーマ JSON をそのまま 1 引数として渡す', () => {
    expect(renderLlmCommand('my-llm --json-schema {schema_inline}', ctx)).toBe(
      `my-llm --json-schema '{"type":"object"}'`,
    )
  })

  it('{model} 使用時に WORKER_LLM_MODEL 未設定なら明示エラー', () => {
    expect(() => renderLlmCommand('my-llm --model {model}', { ...ctx, model: undefined })).toThrow(
      /WORKER_LLM_MODEL/,
    )
  })

  it('usesOutputFile は {output} の有無で判定する', () => {
    expect(usesOutputFile('my-llm --out {output}')).toBe(true)
    expect(usesOutputFile('my-llm --print')).toBe(false)
  })
})

describe('shellQuote', () => {
  it('シングルクォートを含む値も 1 引数として安全に包む', () => {
    expect(shellQuote("CHEF'S KISS")).toBe(`'CHEF'\\''S KISS'`)
  })
})
