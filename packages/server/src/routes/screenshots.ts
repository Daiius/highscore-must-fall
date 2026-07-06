// スクショ自動解析の投入ルート（prd/04 §9.1）。admin 限定（prd/05 §6）。
//
//   - POST /api/screenshots : multipart で画像 1〜5 枚を受け取り、
//     空 draft run + run_image(section=other) + analysis_job(queued) を作成する。
//     どの画像がどの section かは聞かない（LLM の分類に任せておおらかに受ける）。

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createScreenshotSubmission } from '../lib/analysis-jobs'
import { type AppEnv, requireAdmin } from '../lib/context'
import {
  ImageValidationError,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_RUN,
  sanitizeImage,
} from '../lib/images'

/** multipart 全体の上限（10MB × 5枚 + ヘッダ余裕）。 */
const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BYTES * MAX_IMAGES_PER_RUN + 1024 * 1024

const limitUploadBody = bodyLimit({
  maxSize: MAX_UPLOAD_BODY_BYTES,
  onError: (c) => c.json({ ok: false, error: 'リクエストが大きすぎます' }, 413),
})

export const screenshotsRoute = new Hono<AppEnv>().post(
  '/',
  limitUploadBody,
  requireAdmin,
  async (c) => {
    const owner = c.get('user')
    if (!owner) return c.json({ ok: false, error: 'authentication required' }, 401)

    const body = await c.req.parseBody({ all: true })
    const raw = body.images
    const files = (Array.isArray(raw) ? raw : raw !== undefined ? [raw] : []).filter(
      (v): v is File => v instanceof File,
    )
    if (files.length < 1 || files.length > MAX_IMAGES_PER_RUN) {
      return c.json(
        { ok: false, error: `画像は 1〜${MAX_IMAGES_PER_RUN} 枚で送信してください` },
        422,
      )
    }
    if (files.some((f) => f.size > MAX_IMAGE_BYTES)) {
      return c.json({ ok: false, error: '1枚あたり 10MB 以下にしてください' }, 422)
    }

    try {
      const images = []
      for (const file of files) {
        // 実フォーマット検証 + EXIF 除去 + 寸法取得（申告 MIME は信用しない）。
        images.push(await sanitizeImage(new Uint8Array(await file.arrayBuffer())))
      }
      const { runId } = await createScreenshotSubmission(owner.id, images)
      return c.json({ ok: true, runId }, 201)
    } catch (e) {
      if (e instanceof ImageValidationError) {
        return c.json({ ok: false, error: e.message }, 422)
      }
      throw e
    }
  },
)
