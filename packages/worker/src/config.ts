// worker の設定（すべて env 注入）。
// 使用する LLM CLI・モデル・引数はコマンドテンプレートとして env で渡し、
// コードにはツール固有名を置かない（prd/04 §9.2。具体値は非公開の運用メモ側）。

export interface WorkerConfig {
  /** server のベース URL（worker API のエンドポイント）。 */
  serverUrl: string
  /** server と共有する shared secret（prd/05 §6）。 */
  apiToken: string
  /** queued が無いときの polling 間隔。 */
  pollIntervalMs: number
  /**
   * LLM CLI のコマンドテンプレート。プレースホルダ:
   *   {schema}        … 出力 JSON Schema のファイルパス
   *   {schema_inline} … 同スキーマの JSON 文字列（inline 渡しの CLI 用）
   *   {output}        … 出力 JSON の書き込み先パス（無ければ stdout から読む）
   *   {images}        … 画像パス列。`{images:PREFIX}` で各パスの前置詞を指定（例 `{images:-i }`）
   *   {model}         … WORKER_LLM_MODEL の値
   * プロンプトは常に stdin で渡す。
   */
  llmCommand: string
  /** {model} に展開するモデル名（テンプレートが使う場合のみ必須）。 */
  llmModel?: string
  /** LLM 実行のタイムアウト。server 側 lease（30分）より短くする。 */
  llmTimeoutMs: number
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    serverUrl: env.WORKER_SERVER_URL ?? 'http://localhost:4000',
    apiToken: required(env, 'WORKER_API_TOKEN'),
    pollIntervalMs: intEnv(env, 'WORKER_POLL_INTERVAL_MS', 15_000),
    llmCommand: required(env, 'WORKER_LLM_COMMAND'),
    llmModel: env.WORKER_LLM_MODEL,
    llmTimeoutMs: intEnv(env, 'WORKER_LLM_TIMEOUT_MS', 15 * 60 * 1000),
  }
}
