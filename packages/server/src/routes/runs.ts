// run ルート（ingestion の「確定保存 API」）。投入テキストを再パース・再変換・再検証してから保存する。
// 一覧/詳細/削除は後続 PR（Task 3）でこの route チェーンに足す。
//
//   - POST /api/runs : draft / confirmed として保存。
//     confirmed は整合チェックの error が 1 件も無いことを必須にする（prd/04 §4）。
//     draft も「保存する以上は DB 整合を壊さない」ため error 無しを要求する
//     （型不正・週内位置重複などがあると子テーブルへ展開できない）。warning は両者とも許容。
//     ※ 値欠落を含む本当の部分ドラフト（緩い draft スキーマ）は後続の課題（DB は nullable 準備済み）。

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { StoredDatetimeSchema } from 'shared'
import { z } from 'zod'
import { type AppEnv, requireUser } from '../lib/context'
import { ingestSubmission } from '../lib/ingest'
import { saveRun } from '../lib/runs'

const createBody = z.object({
  text: z.string(),
  format: z.enum(['json', 'yaml', 'auto']).default('auto'),
  status: z.enum(['draft', 'confirmed']),
  source: z.enum(['file_import', 'paste']).default('paste'),
  /** 任意の投入日時上書き（ISO8601, offset 付き・MySQL DATETIME 範囲内）。無ければ record.played_at → 投入時刻。 */
  playedAt: StoredDatetimeSchema.optional(),
  llmModel: z.string().max(128).optional(),
  sourceNote: z.string().optional(),
})

export const runsRoute = new Hono<AppEnv>().post(
  '/',
  requireUser,
  zValidator('json', createBody),
  async (c) => {
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
  },
)
