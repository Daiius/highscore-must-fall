// JSON Schema 導出。正規スキーマ（Zod）から機械可読なスキーマを生成する。
// 用途: 分析キット配布（prd/04 §6）・MCP submit_run の入力スキーマ・他言語クライアント。
// contract から生成されるため schema_version 更新に自動追従する。

import { z } from 'zod'
import { RunRecordSchema } from './schema'
import { SCHEMA_VERSION } from './version'

/** 現行 schema_version の RunRecord JSON Schema を識別する `$id`。 */
export const RUN_RECORD_JSON_SCHEMA_ID = `utopia-must-fall/run-record/${SCHEMA_VERSION}` as const

/**
 * RunRecord の JSON Schema を導出する。
 * io='input': ユーザー/LLM が「産出すべき」形（default 付き schema_version・game は任意）。
 */
export function runRecordJsonSchema() {
  return z.toJSONSchema(RunRecordSchema, { io: 'input' })
}
