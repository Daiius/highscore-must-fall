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

/** 引用符を終端まで読み飛ばす（開き引用符の次から呼ぶ）。閉じが無ければ末尾まで。 */
function skipQuoted(template: string, from: number, quote: '"' | "'"): number {
  let i = from
  while (i < template.length) {
    // シングルクォート内はエスケープが効かない（POSIX シェル）。
    if (quote === '"' && template[i] === '\\') i += 2
    else if (template[i] === quote) return i + 1
    else i++
  }
  return i
}

/** `${…}`（パラメータ展開）を入れ子ごと読み飛ばす（`${` の次から呼ぶ）。 */
function skipParameterExpansion(template: string, from: number): number {
  let depth = 1
  let i = from
  while (i < template.length && depth > 0) {
    if (template[i] === '{') depth++
    else if (template[i] === '}') depth--
    i++
  }
  return i
}

const PLACEHOLDER_AT_HEAD = /^\{([a-z_][a-z0-9_]*)(?::([^}]*))?\}/

/**
 * `{name}` 形式のうち展開できないものを列挙する。
 *
 * 綴り違いは**そのまま CLI の引数として渡ってしまい**、無言で壊れる（実例: `{output}` のつもりで
 * `{message}` と書き、LLM CLI が `{message}` という名前のファイルへ結果を書いた。worker は
 * stdout 構成だと判定して結果を stdout から読むため、成功しているように見える）。
 *
 * テンプレートは `/bin/sh -c` に渡る任意のコマンドなので、**引用符の中とパラメータ展開の中は見ない**。
 * `jq '{a: .b}'` や `${var:-{x}}` は正当なシェル構文であり、これを綴り違いと誤判定すると
 * worker がまったく起動できなくなる（誤検出のコストが検出漏れより高い）。
 * `renderLlmCommand` が展開値をクォートするので、**プレースホルダは引用符で囲まない**のが前提。
 */
export function unknownPlaceholders(template: string): string[] {
  const unknown: string[] = []
  let i = 0
  while (i < template.length) {
    const ch = template[i]
    if (ch === '\\') {
      i += 2
    } else if (ch === "'" || ch === '"') {
      i = skipQuoted(template, i + 1, ch)
    } else if (ch === '$' && template[i + 1] === '{') {
      i = skipParameterExpansion(template, i + 2)
    } else if (ch === '{') {
      const m = PLACEHOLDER_AT_HEAD.exec(template.slice(i))
      if (!m) {
        i++
        continue
      }
      const name = m[1] as string // 正規表現が一致した時点で必ず取れる
      const suffix = m[2]
      // 接尾辞つきを展開できるのは images だけ。`{output:file}` 等は既知名でも展開されない。
      const known = suffix === undefined ? KNOWN_PLACEHOLDERS.includes(name) : name === 'images'
      if (!known) unknown.push(suffix === undefined ? name : `${name}:${suffix}`)
      i += m[0].length
    } else {
      i++
    }
  }
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
