// server の worker API クライアント（Hono RPC。型は server/app の AppType を type-only import）。
// 認証は WORKER_API_TOKEN の Bearer ヘッダ（prd/04 §9.2）。

import { writeFile } from 'node:fs/promises'
import { hc } from 'hono/client'
import type { AppType } from 'server/app'
import type { ExtractionSection, ScreenshotExtraction } from 'shared'
import type { WorkerConfig } from './config'

export interface ClaimedJob {
  runId: string
  attemptCount: number
  images: { id: string; contentType: string; byteSize: number }[]
}

export interface CompleteBody {
  extraction: ScreenshotExtraction
  images: { id: string; section: ExtractionSection }[]
  /** claim で受け取った試行番号。server が照合し stale worker を弾く。 */
  attempt: number
  llmModel?: string
}

export type CompleteOutcome =
  | { kind: 'saved'; status: 'draft' | 'confirmed' }
  | { kind: 'invalid_record' } // server 側で failed 記録済み。worker の追加処理は不要。

async function ensureOk(res: Response, what: string): Promise<Response> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${what} failed: HTTP ${res.status} ${body.slice(0, 500)}`)
  }
  return res
}

export class WorkerApi {
  private readonly client: ReturnType<typeof hc<AppType>>

  constructor(config: WorkerConfig) {
    this.client = hc<AppType>(config.serverUrl, {
      headers: { authorization: `Bearer ${config.apiToken}` },
    })
  }

  /** queued のジョブを 1 件 claim する（無ければ null）。 */
  async claim(): Promise<ClaimedJob | null> {
    const res = await ensureOk(await this.client.api.worker.jobs.claim.$post(), 'claim')
    const { job } = (await res.json()) as { job: ClaimedJob | null }
    return job
  }

  /** 処理入力の画像を取得してファイルへ保存する。 */
  async downloadImage(
    runId: string,
    imageId: string,
    destPath: string,
    attempt: number,
  ): Promise<void> {
    const res = await ensureOk(
      await this.client.api.worker.jobs[':runId'].images[':imageId'].$get({
        param: { runId, imageId },
        query: { attempt: String(attempt) },
      }),
      `download image ${imageId}`,
    )
    await writeFile(destPath, Buffer.from(await res.arrayBuffer()))
  }

  /** 抽出結果を提出する（検証・保存・自動確定ゲートは server 側）。 */
  async complete(runId: string, body: CompleteBody): Promise<CompleteOutcome> {
    const res = await this.client.api.worker.jobs[':runId'].complete.$post({
      param: { runId },
      json: body,
    })
    if (res.status === 422) return { kind: 'invalid_record' }
    await ensureOk(res, 'complete')
    const data = (await res.json()) as { ok: boolean; status: 'draft' | 'confirmed' }
    return { kind: 'saved', status: data.status }
  }

  /** エラーを報告してジョブを failed にする。 */
  async fail(runId: string, message: string, attempt: number): Promise<void> {
    await ensureOk(
      await this.client.api.worker.jobs[':runId'].fail.$post({
        param: { runId },
        json: { message, attempt },
      }),
      'fail',
    )
  }
}
