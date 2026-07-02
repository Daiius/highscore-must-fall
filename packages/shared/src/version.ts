// スキーマのバージョニングと旧→新変換器のレジストリ。
// レコードは schema_version を持ち、破壊的変更のたびにここを更新する。
// 詳細: ../../.claude/rules/schema-and-contract.md §バージョニング / prd/03,04

export const SCHEMA_VERSION = '0.1.0' as const

/** 旧バージョンの生ペイロードを「1 段だけ次のバージョン」へ移す変換器。 */
export type SchemaConverter = (raw: Record<string, unknown>) => Record<string, unknown>

/**
 * `fromVersion -> nextVersion` の変換器レジストリ。
 * 破壊的変更を入れるたびに旧バージョンをキーに 1 段追加し、
 * migrateToCurrent が現行まで連鎖適用する。MVP は初版 0.1.0 のみのため空。
 */
export const CONVERTERS: Readonly<Record<string, SchemaConverter>> = {}

/**
 * 生ペイロード（既存 raw_payload 等）を現行 schema_version まで移行する。
 * 既に現行なら素通し。移行経路が無いバージョンは明示的にエラーにする。
 */
export function migrateToCurrent(raw: Record<string, unknown>): Record<string, unknown> {
  let current = raw
  let version = readVersion(current)
  while (version !== SCHEMA_VERSION) {
    const convert = CONVERTERS[version]
    if (!convert) {
      throw new Error(
        `schema_version "${version}" から現行 ${SCHEMA_VERSION} への変換器がありません`,
      )
    }
    current = convert(current)
    version = readVersion(current)
  }
  return current
}

function readVersion(raw: Record<string, unknown>): string {
  const version = raw.schema_version
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('schema_version が文字列で存在しません')
  }
  return version
}
