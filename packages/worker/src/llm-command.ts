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

/** 展開できるプレースホルダ名。接尾辞（`:PREFIX`）を取れるのは `{images:PREFIX}` だけ。 */
const KNOWN_PLACEHOLDERS = ['schema', 'schema_inline', 'output', 'images', 'model']

/**
 * `{name}` 形式のうち展開できないものを列挙する。
 *
 * 綴り違いは**そのまま CLI の引数として渡ってしまい**、無言で壊れる（実例: `{output}` のつもりで
 * `{message}` と書き、LLM CLI が `{message}` という名前のファイルへ結果を書いた。worker は
 * stdout 構成だと判定して結果を stdout から読むため、成功しているように見える）。
 * 起動時に落とすため、綴り違いだけを拾う保守的な形（小文字トークン・`${VAR}` は除外）で検出する。
 */
export function unknownPlaceholders(template: string): string[] {
  const found = template.matchAll(/(?<!\$)\{([a-z_][a-z0-9_]*)(?::([^}]*))?\}/g)
  const unknown = [...found]
    // 接尾辞つきを展開できるのは images だけ。`{output:file}` 等は既知名でも展開されない。
    .filter(([, name, suffix]) =>
      suffix === undefined ? !KNOWN_PLACEHOLDERS.includes(name as string) : name !== 'images',
    )
    .map(([, name, suffix]) => (suffix === undefined ? (name as string) : `${name}:${suffix}`))
  return [...new Set(unknown)]
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
