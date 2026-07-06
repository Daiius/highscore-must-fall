// worker 専用 API（prd/04 §9.2）。ユーザー認証とは別系統の WORKER_API_TOKEN（shared secret）で
// 保護する（prd/05 §6）。worker は分離した実行環境から outbound polling でここを叩く。
//
//   - POST /api/worker/jobs/claim              : queued を1件、排他的に running へ。
//   - GET  /api/worker/jobs/:runId/images/:id  : 処理入力の画像を取得。
//   - POST /api/worker/jobs/:runId/complete    : 抽出結果を反映（検証 → 保存 → 自動確定ゲート）。
//   - POST /api/worker/jobs/:runId/fail        : エラー報告（job を failed に）。

import { timingSafeEqual } from 'node:crypto'
import { zValidator } from '@hono/zod-validator'
import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { EXTRACTION_SECTIONS, ScreenshotExtractionSchema } from 'shared'
import { z } from 'zod'
import { claimNextJob, completeJob, failJob, getJobImage } from '../lib/analysis-jobs'
import { blobStore } from '../lib/blob-store'
import { limitIngestBody } from '../lib/context'

const workerToken = process.env.WORKER_API_TOKEN

/** 固定長比較（タイミング攻撃対策）。長さが違う場合も比較時間を揃える。 */
function tokenMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

/** WORKER_API_TOKEN が未設定の環境では worker API 全体を無効化する（fail-closed）。 */
const requireWorkerToken: MiddlewareHandler = async (c, next) => {
  if (!workerToken) {
    throw new HTTPException(503, { message: 'worker API is disabled (WORKER_API_TOKEN unset)' })
  }
  const header = c.req.header('authorization') ?? ''
  const candidate = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!candidate || !tokenMatches(candidate, workerToken)) {
    throw new HTTPException(401, { message: 'invalid worker token' })
  }
  await next()
}

/** claim で受け取った試行番号。complete/fail/画像取得で照合し stale worker を弾く（prd/04 §9.5）。 */
const attemptField = z.coerce.number().int().min(1)

const completeBody = z.object({
  extraction: ScreenshotExtractionSchema,
  /** run_image.id → section の対応（worker が LLM 出力の index を id へ引き直した結果）。 */
  images: z.array(z.object({ id: z.string().max(36), section: z.enum(EXTRACTION_SECTIONS) })),
  attempt: attemptField,
  llmModel: z.string().max(128).optional(),
})

const failBody = z.object({
  message: z.string().min(1).max(65_535),
  attempt: attemptField,
})

const imageQuery = z.object({ attempt: attemptField })

export const workerRoute = new Hono()
  .use('*', requireWorkerToken)
  .post('/jobs/claim', async (c) => {
    const job = await claimNextJob()
    return c.json({ job })
  })
  .get('/jobs/:runId/images/:imageId', zValidator('query', imageQuery), async (c) => {
    const { attempt } = c.req.valid('query')
    const image = await getJobImage(c.req.param('runId'), c.req.param('imageId'), attempt)
    if (!image) return c.json({ error: 'not found' }, 404)
    const stream = await blobStore.getStream(image.storageKey)
    return c.body(stream, 200, { 'Content-Type': image.contentType })
  })
  .post('/jobs/:runId/complete', limitIngestBody, zValidator('json', completeBody), async (c) => {
    const { extraction, images, attempt, llmModel } = c.req.valid('json')
    const result = await completeJob(c.req.param('runId'), extraction, images, attempt, llmModel)
    if (result.kind === 'not_running') return c.json({ ok: false, error: 'job not running' }, 409)
    if (result.kind === 'invalid_record') {
      // ジョブは failed 済み。worker 側の追加処理は不要（issues は記録・デバッグ用）。
      return c.json({ ok: false, error: 'invalid record', issues: result.issues }, 422)
    }
    return c.json({ ok: true, status: result.status, issues: result.issues })
  })
  .post('/jobs/:runId/fail', limitIngestBody, zValidator('json', failBody), async (c) => {
    const { message, attempt } = c.req.valid('json')
    const failed = await failJob(c.req.param('runId'), message, attempt)
    if (!failed) return c.json({ ok: false, error: 'job not running' }, 409)
    return c.json({ ok: true })
  })
