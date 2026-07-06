// 1 ジョブの処理: 画像ダウンロード → LLM CLI 実行（JSON Schema 強制）→ 出力検証 → complete/fail。
// エラー時の自動リトライはしない（即 fail 報告 → 人間が UI から再解析。prd/04 §9.5）。

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { screenshotExtractionJsonSchema } from 'shared'
import type { WorkerConfig } from './config'
import { renderLlmCommand, usesOutputFile } from './llm-command'
import { parseExtractionOutput } from './output'
import { buildExtractionPrompt } from './prompt'
import type { ClaimedJob, WorkerApi } from './server-client'

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** stdout / stderr それぞれのメモリ上限。超過したら kill して failed に落とす（OOM 回避）。 */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  outputOverflow: boolean
}

/**
 * テンプレート展開済みコマンドをシェル経由で実行し、プロンプトを stdin で渡す。
 * detached で独立プロセスグループにし、タイムアウト/出力過多では **グループ全体**を kill する
 * （シェルだけ殺すと LLM CLI やパイプラインの子プロセスが残るため）。
 * stdout/stderr はバイト上限で打ち切り、無制限のメモリ連結による OOM を防ぐ。
 */
function runCommand(command: string, stdin: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let outputOverflow = false

    // detached なので child.pid はグループリーダ。-pid でグループ全体へシグナルを送る。
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      killGroup()
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        outputOverflow = true
        killGroup()
        return
      }
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        outputOverflow = true
        killGroup()
        return
      }
      stderr += chunk.toString()
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut, outputOverflow })
    })
    // 子が即死して stdin が閉じると EPIPE。握りつぶす（close で結果を返す）。
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}

/** 失敗報告に載せるエラー詳細（stderr は末尾を優先して切り詰める）。 */
function describeFailure(prefix: string, result: CommandResult): string {
  const stderrTail = result.stderr.trim().slice(-1500)
  return [prefix, stderrTail && `stderr:\n${stderrTail}`].filter(Boolean).join('\n')
}

/**
 * claim 済みジョブを 1 件処理する。成功時は complete、あらゆる失敗は fail 報告に落とす。
 * fail 報告自体の失敗は投げ直す（daemon がログして次の poll へ。lease 超過が最終的に回収する）。
 */
export async function processJob(
  api: WorkerApi,
  config: WorkerConfig,
  job: ClaimedJob,
): Promise<void> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'hmf-worker-'))
  try {
    try {
      // 画像を index 順のファイル名で保存（プロンプト・添付・complete の対応の基準）。
      const imagePaths: string[] = []
      for (const [index, image] of job.images.entries()) {
        const ext = EXT_BY_CONTENT_TYPE[image.contentType] ?? 'bin'
        const dest = path.join(workDir, `image-${index}.${ext}`)
        await api.downloadImage(job.runId, image.id, dest, job.attemptCount)
        imagePaths.push(dest)
      }

      const schemaPath = path.join(workDir, 'extraction.schema.json')
      const schemaJson = JSON.stringify(screenshotExtractionJsonSchema())
      await writeFile(schemaPath, schemaJson)
      const outputPath = path.join(workDir, 'extraction.json')

      const command = renderLlmCommand(config.llmCommand, {
        schemaPath,
        schemaJson,
        outputPath,
        imagePaths,
        model: config.llmModel,
      })
      const prompt = buildExtractionPrompt(imagePaths)
      const result = await runCommand(command, prompt, config.llmTimeoutMs)

      if (result.outputOverflow) {
        await api.fail(
          job.runId,
          `LLM 実行の出力が上限（${MAX_OUTPUT_BYTES} bytes）を超えたため中断しました`,
          job.attemptCount,
        )
        return
      }
      if (result.timedOut) {
        await api.fail(
          job.runId,
          `LLM 実行がタイムアウトしました（${config.llmTimeoutMs}ms）`,
          job.attemptCount,
        )
        return
      }
      if (result.code !== 0) {
        await api.fail(
          job.runId,
          describeFailure(`LLM 実行が終了コード ${result.code} で失敗しました`, result),
          job.attemptCount,
        )
        return
      }

      let raw: string
      if (usesOutputFile(config.llmCommand)) {
        // 出力ファイルも読み込む前にサイズ上限を確認する（stdout/stderr と同じ上限。
        // 異常な CLI が巨大ファイルを吐いても無制限 readFile で OOM/ディスク枯渇しないように）。
        const size = await stat(outputPath)
          .then((s) => s.size)
          .catch(() => 0)
        if (size > MAX_OUTPUT_BYTES) {
          await api.fail(
            job.runId,
            `LLM 出力ファイルが上限（${MAX_OUTPUT_BYTES} bytes）を超えました（${size} bytes）`,
            job.attemptCount,
          )
          return
        }
        raw = await readFile(outputPath, 'utf8')
      } else {
        raw = result.stdout
      }
      const extraction = parseExtractionOutput(raw)

      // LLM 出力の index → run_image.id。範囲外や欠けは無視（欠けた画像は section=other のまま）。
      const imageSections = extraction.images.flatMap((entry) => {
        const image = job.images[entry.index]
        return image ? [{ id: image.id, section: entry.section }] : []
      })

      const outcome = await api.complete(job.runId, {
        extraction,
        images: imageSections,
        attempt: job.attemptCount,
        llmModel: config.llmModel,
      })
      if (outcome.kind === 'saved') {
        console.log(`[worker] run ${job.runId}: 解析完了（${outcome.status}）`)
      } else {
        console.warn(`[worker] run ${job.runId}: 解析結果が検証を通らず failed（server 記録済み）`)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[worker] run ${job.runId}: 失敗 — ${message}`)
      await api.fail(job.runId, message, job.attemptCount)
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
