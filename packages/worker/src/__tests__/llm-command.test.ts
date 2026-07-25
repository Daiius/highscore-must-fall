import { describe, expect, it } from 'vitest'
import { renderLlmCommand, shellQuote, unknownPlaceholders, usesOutputFile } from '../llm-command'

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

describe('unknownPlaceholders', () => {
  it('展開できるプレースホルダは拾わない', () => {
    expect(
      unknownPlaceholders('my-llm --schema {schema} --out {output} --model {model} {images:-i } -'),
    ).toEqual([])
    expect(unknownPlaceholders('my-llm --json-schema {schema_inline}')).toEqual([])
  })

  it('綴り違いを検出する（{output} のつもりの {message} 等）', () => {
    expect(unknownPlaceholders('my-llm --output-last-message {message}')).toEqual(['message'])
    expect(unknownPlaceholders('my-llm {out} {images}')).toEqual(['out'])
  })

  it('接尾辞を展開できるのは {images:PREFIX} だけ', () => {
    expect(unknownPlaceholders('my-llm {images:-i } {images:}')).toEqual([])
    expect(unknownPlaceholders('my-llm --out {output:file} --schema {schema:path}')).toEqual([
      'output:file',
      'schema:path',
    ])
  })

  it('同じ綴り違いは 1 回だけ報告する', () => {
    expect(unknownPlaceholders('my-llm {message} then {message}')).toEqual(['message'])
  })

  it('シェル構文（変数展開・引用符内）は誤検出しない', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: シェルの変数展開そのものを検査する意図
    expect(unknownPlaceholders('my-llm ${HOME}/bin/x')).toEqual([])
    expect(unknownPlaceholders(`my-llm | awk '{print $1}'`)).toEqual([])
    // 引用符の中はシェル片として扱い、プレースホルダとみなさない。
    expect(
      unknownPlaceholders(`my-llm --out {output} | jq '{score: .result.final_score}'`),
    ).toEqual([])
    expect(unknownPlaceholders('my-llm | jq "{a: .b}"')).toEqual([])
    // 入れ子のパラメータ展開も中を見ない。
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 同上
    expect(unknownPlaceholders('my-llm ${model:-{fallback}}')).toEqual([])
  })

  it('引用符が閉じていなくても走査が止まらない', () => {
    expect(unknownPlaceholders(`my-llm 'unterminated {message}`)).toEqual([])
    expect(unknownPlaceholders(`my-llm {message} 'unterminated`)).toEqual(['message'])
  })
})

describe('shellQuote', () => {
  it('シングルクォートを含む値も 1 引数として安全に包む', () => {
    expect(shellQuote("CHEF'S KISS")).toBe(`'CHEF'\\''S KISS'`)
  })
})
