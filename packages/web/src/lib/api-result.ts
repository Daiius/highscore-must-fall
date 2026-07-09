// API 呼び出しの結果型（Rust の Result<T, E> 相当）と、唯一の try/catch。
//
// なぜコンポーネントから try/catch を追い出すか:
//   React Compiler 1.0 は **try/catch の中の value block**（`??` / `?.` / 三項 / `&&`）と
//   `finally` / `throw` をまだ実装していない（エラーは `Todo:` で始まる）。
//   コンポーネント本体に try/catch があると、そのコンポーネントは丸ごとコンパイル対象から外れ、
//   `useEffect(..., [fetchRun])` のような「メモ化されている前提」の依存配列が毎レンダー変わり、
//   再取得ループになる。→ 既知の未実装: https://github.com/facebook/react/issues/35570
//
// そこで I/O とエラー処理をこのモジュール（コンポーネント外＝コンパイラ対象外）に閉じ込め、
// 呼び出し側は Ok / Err を分岐するだけにする。.claude/rules/react.md

/** 失敗の種類。呼び出し側はこれで分岐する（HTTP の詳細をコンポーネントに漏らさない）。 */
export type ApiFailure =
  /** 401。セッション切れ。呼び出し側は clearSession() する。 */
  | { kind: 'unauthorized' }
  /** 2xx 以外。body は各エンドポイントの失敗レスポンス（issues / error など）。 */
  | { kind: 'status'; status: number; body: unknown }
  /** 通信自体が失敗（オフライン・DNS・CORS など）。 */
  | { kind: 'network' }

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure }

/** fetch/Hono RPC のレスポンスに共通して要求する形。 */
interface JsonResponse {
  status: number
  ok: boolean
  json(): Promise<unknown>
}

/**
 * 送信して Result に畳む。**このリポジトリで唯一 try/catch を書いてよい場所**。
 *
 * body は成功・失敗どちらでも読む（422 の issues を呼び出し側が使うため）。
 * 204 など本文が無い応答では json() が失敗するので null にフォールバックする。
 */
export async function callApi<T>(send: () => Promise<JsonResponse>): Promise<ApiResult<T>> {
  try {
    const res = await send()
    if (res.status === 401) return { ok: false, error: { kind: 'unauthorized' } }
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: { kind: 'status', status: res.status, body } }
    return { ok: true, value: body as T }
  } catch {
    return { ok: false, error: { kind: 'network' } }
  }
}

/**
 * throw しうる副作用（clipboard 書き込み・OAuth 開始など）を成否の真偽値に畳む。
 * callApi と同じ理由でコンポーネントの外に置く。
 */
export async function attempt(run: () => Promise<void>): Promise<boolean> {
  try {
    await run()
    return true
  } catch {
    return false
  }
}
