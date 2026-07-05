// LLM CLI の出力から抽出 JSON を取り出す。CLI により出力の載せ方が異なるため、
// ここで差異を吸収する（prd/04 §9.3。テンプレートと同様、固有名には依存しない）:
//   - 出力ファイル / stdout いずれも「JSON そのもの」または
//     「JSON をフィールド（structured_output）に包んだ envelope」を受理する。
//   - 万一コードフェンスで包まれていた場合も剥がす（防御的）。

import { type ScreenshotExtraction, ScreenshotExtractionSchema } from 'shared'

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/)
  return match?.[1] ?? trimmed
}

/** 生テキストから抽出結果をパース・検証する。失敗は Error（呼び出し側が fail 報告に使う）。 */
export function parseExtractionOutput(raw: string): ScreenshotExtraction {
  let value: unknown
  try {
    value = JSON.parse(stripCodeFence(raw))
  } catch (e) {
    throw new Error(`LLM 出力が JSON としてパースできません: ${(e as Error).message}`)
  }
  // envelope（例: { structured_output: {...} }）なら中身を取り出す。
  if (
    typeof value === 'object' &&
    value !== null &&
    'structured_output' in value &&
    typeof (value as Record<string, unknown>).structured_output === 'object'
  ) {
    value = (value as Record<string, unknown>).structured_output
  }
  const parsed = ScreenshotExtractionSchema.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`LLM 出力が抽出スキーマに一致しません: ${issues}`)
  }
  return parsed.data
}
