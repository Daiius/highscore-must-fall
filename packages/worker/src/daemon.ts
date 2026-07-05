// polling ループ（prd/04 §9.2）。queued があれば連続処理し、無ければ interval だけ待つ。
// worker 側に受け口は持たない（outbound のみ）。SIGINT/SIGTERM で現在のジョブ完了後に停止する。

import type { WorkerConfig } from './config'
import { processJob } from './process-job'
import { WorkerApi } from './server-client'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function runDaemon(config: WorkerConfig): Promise<void> {
  const api = new WorkerApi(config)
  let stopping = false
  const stop = (signal: string) => {
    console.log(`[worker] ${signal} を受信。現在のジョブ完了後に停止します。`)
    stopping = true
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  console.log(`[worker] 起動: ${config.serverUrl} を ${config.pollIntervalMs}ms 間隔で polling`)
  while (!stopping) {
    let job = null
    try {
      job = await api.claim()
    } catch (e) {
      // server 停止中などの一時障害。次の poll に任せる（ジョブ処理中の失敗は processJob が fail 報告する）。
      console.error(`[worker] claim に失敗: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (job) {
      console.log(`[worker] run ${job.runId} を処理開始（attempt ${job.attemptCount}）`)
      try {
        await processJob(api, config, job)
      } catch (e) {
        // fail 報告自体の失敗。lease 超過（server 側）が最終的に failed へ回収する。
        console.error(`[worker] fail 報告に失敗: ${e instanceof Error ? e.message : String(e)}`)
      }
      continue
    }
    await sleep(config.pollIntervalMs)
  }
  console.log('[worker] 停止しました')
}
