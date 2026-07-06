// LLM CLI コマンドテンプレートの展開。
// テンプレートは env（WORKER_LLM_COMMAND）から来る運用者自身の設定であり、ここでの
// クォートはインジェクション防御ではなく「パスに空白等が混ざっても壊れない」ための整形。

export interface CommandContext {
  schemaPath: string
  schemaJson: string
  outputPath: string
  imagePaths: string[]
  model?: string
}

/** POSIX シェルのシングルクォートで包む（内部の ' は '\'' に置換）。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** テンプレートが {output} を使うか（使わなければ stdout から結果を読む）。 */
export function usesOutputFile(template: string): boolean {
  return template.includes('{output}')
}

/**
 * コマンドテンプレートを実際のコマンド文字列へ展開する。
 * `{images:PREFIX}` は各画像パスを PREFIX 付きで並べる（例 `{images:-i }` → `-i 'a' -i 'b'`）。
 */
export function renderLlmCommand(template: string, ctx: CommandContext): string {
  return template
    .replaceAll(/\{images(?::([^}]*))?\}/g, (_, prefix: string | undefined) =>
      ctx.imagePaths.map((p) => `${prefix ?? ''}${shellQuote(p)}`).join(' '),
    )
    .replaceAll('{schema_inline}', shellQuote(ctx.schemaJson))
    .replaceAll('{schema}', shellQuote(ctx.schemaPath))
    .replaceAll('{output}', shellQuote(ctx.outputPath))
    .replaceAll(/\{model\}/g, () => {
      if (!ctx.model)
        throw new Error('テンプレートが {model} を使うのに WORKER_LLM_MODEL が未設定です')
      return shellQuote(ctx.model)
    })
}
