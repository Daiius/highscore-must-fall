// run ルート（ingestion の「確定保存 API」＋一覧/詳細/削除）。すべて owner_id で分離する。
//
//   - POST   /api/runs      : draft / confirmed として保存（投入テキストを再パース・再変換・再検証）。
//     confirmed は整合チェックの error が 1 件も無いことを必須にする（prd/04 §4）。
//     draft も「保存する以上は DB 整合を壊さない」ため error 無しを要求する
//     （型不正・週内位置重複などがあると子テーブルへ展開できない）。warning は両者とも許容。
//     ※ 値欠落を含む本当の部分ドラフト（緩い draft スキーマ）は後続の課題（DB は nullable 準備済み）。
//   - GET    /api/runs      : owner の run 一覧（コア指標のみ・新しい順・ページング・総件数付き）。
//   - GET    /api/runs/:id  : owner の run 詳細（子エントリ + カタログ表示名 + payload + 画像メタ）。
//   - DELETE /api/runs/:id  : owner の run 削除（子テーブルは複合 FK cascade）。

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { StoredDatetimeSchema } from 'shared'
import { z } from 'zod'
import { type AppEnv, limitIngestBody, requireUser } from '../lib/context'
import { ingestSubmission } from '../lib/ingest'
import { deleteRun, getRunDetail, listRuns } from '../lib/run-queries'
import { saveRun, updateRunStatus } from '../lib/runs'

/** run_payload.source_note は MySQL TEXT（最大 65535 バイト）。UTF-8 バイト長で制限する。 */
const TEXT_MAX_BYTES = 65535

const createBody = z.object({
  // 本文全体は bodyLimit で 2MB に制限済み。text 単体もさらに保守的に上限を置く。
  text: z.string().max(1_000_000),
  format: z.enum(['json', 'yaml', 'auto']).default('auto'),
  status: z.enum(['draft', 'confirmed']),
  source: z.enum(['file_import', 'paste']).default('paste'),
  /** 任意の投入日時上書き（ISO8601, offset 付き・MySQL DATETIME 範囲内）。無ければ record.played_at → 投入時刻。 */
  playedAt: StoredDatetimeSchema.optional(),
  llmModel: z.string().max(128).optional(),
  sourceNote: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') <= TEXT_MAX_BYTES, {
      message: `source_note が長すぎます（UTF-8 で ${TEXT_MAX_BYTES} バイト以内）`,
    })
    .optional(),
})

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['draft', 'confirmed']).optional(),
})

export const runsRoute = new Hono<AppEnv>()
  .post('/', limitIngestBody, requireUser, zValidator('json', createBody), async (c) => {
    const body = c.req.valid('json')
    const owner = c.get('user')
    // requireUser 通過後は非 null（型の絞り込みのためのガード）。
    if (!owner) return c.json({ error: 'authentication required' }, 401)

    const result = ingestSubmission(body.text, body.format)
    // draft/confirmed とも error があれば保存不可（DB 整合を壊さないため）。
    if (!result.ok || !result.record) {
      return c.json({ ok: false, issues: result.issues }, 422)
    }

    const saved = await saveRun({
      record: result.record,
      ownerId: owner.id,
      status: body.status,
      source: body.source,
      playedAt: body.playedAt ? new Date(body.playedAt) : undefined,
      llmModel: body.llmModel,
      sourceNote: body.sourceNote,
    })

    // 保存できても warning は残せる（apocalypse_bonus 不一致など要確認）。
    return c.json(
      { ok: true, runId: saved.runId, status: saved.status, issues: result.issues },
      201,
    )
  })
  // 一覧（owner の run のみ・コア指標・新しい順・ページング）。
  .get('/', requireUser, zValidator('query', listQuery), async (c) => {
    const owner = c.get('user')
    if (!owner) return c.json({ error: 'authentication required' }, 401)
    const { limit, offset, status } = c.req.valid('query')
    const result = await listRuns(owner.id, { limit, offset, status })
    return c.json(result)
  })
  // 詳細（owner の run のみ）。他ユーザー/存在しない id は 404。
  .get('/:id', requireUser, async (c) => {
    const owner = c.get('user')
    if (!owner) return c.json({ error: 'authentication required' }, 401)
    const detail = await getRunDetail(owner.id, c.req.param('id'))
    if (!detail) return c.json({ error: 'not found' }, 404)
    return c.json(detail)
  })
  // status 遷移（owner の run のみ）。確定は raw_payload を現行契約で再検証し
  // error があれば 422 で遷移しない。再ドラフト（confirmed→draft）は検証なし。冪等。
  .patch(
    '/:id',
    requireUser,
    zValidator('json', z.object({ status: z.enum(['draft', 'confirmed']) })),
    async (c) => {
      const owner = c.get('user')
      if (!owner) return c.json({ error: 'authentication required' }, 401)
      const body = c.req.valid('json')
      const result = await updateRunStatus(owner.id, c.req.param('id'), body.status)
      if (result.kind === 'not_found') return c.json({ error: 'not found' }, 404)
      if (result.kind === 'invalid') return c.json({ ok: false, issues: result.issues }, 422)
      return c.json({ ok: true, status: result.status, issues: result.issues })
    },
  )
  // 削除（owner の run のみ・子テーブルは複合 FK cascade）。
  .delete('/:id', requireUser, async (c) => {
    const owner = c.get('user')
    if (!owner) return c.json({ error: 'authentication required' }, 401)
    const deleted = await deleteRun(owner.id, c.req.param('id'))
    if (!deleted) return c.json({ error: 'not found' }, 404)
    return c.body(null, 204)
  })
