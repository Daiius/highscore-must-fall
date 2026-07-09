// run ルート（ingestion の「確定保存 API」＋一覧/詳細/削除）。すべて owner_id で分離する。
//
//   - POST   /api/runs      : draft / confirmed として保存（投入テキストを再パース・再変換・再検証）。
//     confirmed は整合チェックの error が 1 件も無いことを必須にする（prd/04 §4）。
//     draft も「保存する以上は DB 整合を壊さない」ため error 無しを要求する
//     （型不正・週内位置重複などがあると子テーブルへ展開できない）。warning は両者とも許容。
//     ※ 値欠落を含む本当の部分ドラフト（緩い draft スキーマ）は後続の課題（DB は nullable 準備済み）。
//   - GET    /api/runs      : owner の run 一覧（コア指標のみ・新しい順・ページング・総件数付き）。
//   - GET    /api/runs/:id  : owner の run 詳細（子エントリ + カタログ表示名 + payload + 画像メタ）。
//   - PUT    /api/runs/:id/record : draft の中身を手動修正で丸ごと置き換える（読み取りミスの訂正）。
//   - DELETE /api/runs/:id  : owner の run 削除（子テーブルは複合 FK cascade）。

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { StoredDatetimeSchema, validateRunRecord } from 'shared'
import { z } from 'zod'
import { requeueAnalysis } from '../lib/analysis-jobs'
import { blobStore } from '../lib/blob-store'
import { type AppEnv, limitIngestBody, requireAdmin, requireUser } from '../lib/context'
import { ingestSubmission, toCanonicalRunRecord } from '../lib/ingest'
import { deleteRun, getRunDetail, getRunImage, listRuns } from '../lib/run-queries'
import { saveRun, updateRunRecord, updateRunStatus } from '../lib/runs'

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

/**
 * 手動修正の本文。record は素の値のまま受け、shared の contract（toCanonicalRunRecord →
 * validateRunRecord）で検証する。ここで形を二重定義すると投入ルートと検証が枝分かれするため、
 * ルート層では「record というキーで何か来る」ことだけを保証する。
 * order_in_week は送らせない（週内連番はアダプタが配列順から採番する）。
 */
const recordBody = z.object({ record: z.unknown() })

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
      if (result.kind === 'analysis_in_progress') {
        return c.json({ ok: false, error: 'analysis in progress' }, 409)
      }
      if (result.kind === 'invalid') return c.json({ ok: false, issues: result.issues }, 422)
      return c.json({ ok: true, status: result.status, issues: result.issues })
    },
  )
  // 手動修正（draft の中身を丸ごと置き換える。prd/04 §4）。
  // 投入ルートと同じ品質ゲート（shared の Zod + 整合チェック）を通し、error があれば 422 で書き込まない。
  // warning（apocalypse_bonus 不一致など）は保存しつつ返す＝直しながら保存できる。
  .put('/:id/record', limitIngestBody, requireUser, zValidator('json', recordBody), async (c) => {
    const owner = c.get('user')
    if (!owner) return c.json({ error: 'authentication required' }, 401)

    const result = validateRunRecord(toCanonicalRunRecord(c.req.valid('json').record))
    if (!result.ok || !result.record) return c.json({ ok: false, issues: result.issues }, 422)

    const updated = await updateRunRecord(owner.id, c.req.param('id'), result.record)
    if (updated.kind === 'not_found') return c.json({ ok: false, error: 'not found' }, 404)
    if (updated.kind === 'run_not_draft') {
      return c.json(
        { ok: false, error: '確定済みの run は下書きに戻してから編集してください' },
        409,
      )
    }
    if (updated.kind === 'analysis_in_progress') {
      return c.json({ ok: false, error: '解析中は編集できません' }, 409)
    }
    return c.json({ ok: true, issues: result.issues })
  })
  // 削除（owner の run のみ・子テーブルは複合 FK cascade。画像実体も削除）。
  .delete('/:id', requireUser, async (c) => {
    const owner = c.get('user')
    if (!owner) return c.json({ error: 'authentication required' }, 401)
    const deleted = await deleteRun(owner.id, c.req.param('id'))
    if (!deleted) return c.json({ error: 'not found' }, 404)
    return c.body(null, 204)
  })
  // スクショ実体の配信（owner の run のみ・認証エンドポイント経由。直リンク不可。prd/04 §7）。
  .get('/:id/images/:imageId', requireUser, async (c) => {
    const owner = c.get('user')
    if (!owner) return c.json({ error: 'authentication required' }, 401)
    const image = await getRunImage(owner.id, c.req.param('id'), c.req.param('imageId'))
    if (!image) return c.json({ error: 'not found' }, 404)
    const stream = await blobStore.getStream(image.storageKey)
    return c.body(stream, 200, {
      'Content-Type': image.contentType,
      // 認証付き・本人のみのため private。実体は不変（再アップロードは別 id）なので長めに持てる。
      'Cache-Control': 'private, max-age=86400',
    })
  })
  // 再解析（スクショ自動解析の再キュー。admin 限定・draft のみ。prd/04 §9.1）。
  .post('/:id/reanalyze', requireAdmin, async (c) => {
    const owner = c.get('user')
    if (!owner) return c.json({ error: 'authentication required' }, 401)
    const result = await requeueAnalysis(owner.id, c.req.param('id'))
    if (result === 'not_found') return c.json({ ok: false, error: 'not found' }, 404)
    if (result === 'run_not_draft') {
      return c.json(
        { ok: false, error: '確定済みの run は下書きに戻してから再解析してください' },
        409,
      )
    }
    if (result === 'already_running') {
      return c.json({ ok: false, error: '解析が実行中です' }, 409)
    }
    return c.json({ ok: true })
  })
