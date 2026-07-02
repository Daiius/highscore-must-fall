// ingestion ルート（検証・分析キット配布）。全投入ルート共通の検証層への Web 入口。
//
//   - POST /api/ingest/validate : JSON/YAML を受け取り、フラット形→正規形変換 → shared 検証・
//     整合チェック（DB 書込なし）。レビュー画面が error/warning を表示するために使う（prd/04 §4）。
//   - GET  /api/ingest/json-schema : 現行 schema_version の JSON Schema（分析キット配布。prd/04 §6）。

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { runRecordJsonSchema } from 'shared'
import { z } from 'zod'
import { type AppEnv, limitIngestBody, requireUser } from '../lib/context'
import { ingestSubmission } from '../lib/ingest'

const validateBody = z.object({
  // 本文全体は bodyLimit で 2MB に制限済み。text 単体もさらに保守的に上限を置く。
  text: z.string().max(1_000_000),
  format: z.enum(['json', 'yaml', 'auto']).default('auto'),
})

export const ingestRoute = new Hono<AppEnv>()
  // 検証は認証済みユーザーのみ（投入と同じ境界に揃える）。
  .post('/validate', limitIngestBody, requireUser, zValidator('json', validateBody), (c) => {
    const { text, format } = c.req.valid('json')
    return c.json(ingestSubmission(text, format))
  })
  // JSON Schema は配布物（未ログインでも取得できてよい）。
  .get('/json-schema', (c) => c.json(runRecordJsonSchema()))
