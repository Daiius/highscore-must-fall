// 1 ジョブの処理: 画像ダウンロード → LLM CLI 実行（JSON Schema 強制）→ 出力検証 → complete/fail。
// エラー時の自動リトライはしない（即 fail 報告 → 人間が UI から再解析。prd/04 §9.5）。

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { screenshotExtractionJsonSchema } from 'shared'
import type { WorkerConfig } from './config'
import { splitIntoColumns } from './image/columns'
import { renderLlmCommand, usesOutputFile } from './llm-command'
import { parseExtractionOutput } from './output'
import { buildExtractionPrompt, type PromptImage } from './prompt'
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
function runCommand(
  command: string,
  stdin: string,
  timeoutMs: number,
  watchOutputPath?: string,
): Promise<CommandResult> {
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

    // {output} 構成では出力ファイルを**実行中も**監視し、上限超過ならその場でグループを kill する
    // （終了後の stat だけだと、書き続けられてディスクを枯渇させられるため。HSF-F9DE08A5）。
    const watcher = watchOutputPath
      ? setInterval(() => {
          try {
            if (statSync(watchOutputPath).size > MAX_OUTPUT_BYTES) {
              outputOverflow = true
              killGroup()
            }
          } catch {
            // ファイル未作成など。次の tick で再確認。
          }
        }, 500)
      : undefined
    const cleanup = () => {
      clearTimeout(timer)
      if (watcher) clearInterval(watcher)
    }

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
      cleanup()
      reject(e)
    })
    child.on('close', (code) => {
      cleanup()
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
 * 多列レイアウトの画像を列ごとに切り出して並べる（prd/04 §9.3）。
 *
 * UPGRADE HISTORY は列を跨いで並びが連続するため、1 枚のまま読ませると後ろの週が前の週へ
 * 吸い込まれる。列ごとに渡すと読み順の曖昧さが構造的に消える（詳細は image/columns.ts）。
 *
 * **これは補助であって前提ではない**。切れない画像（PNG 以外・レイアウトを検出できない・
 * 読み書きの失敗）は黙って元画像だけで進む。列画像が無いときはプロンプトが従来のルールに
 * 切り替わるので、ここで失敗させる理由がない。
 */
async function buildColumnImages(
  job: ClaimedJob,
  workDir: string,
  originals: PromptImage[],
): Promise<PromptImage[]> {
  const columns: PromptImage[] = []
  for (const [index, image] of job.images.entries()) {
    if (image.contentType !== 'image/png') continue
    const source = originals[index]
    if (!source) continue
    try {
      for (const column of splitIntoColumns(await readFile(source.path))) {
        const dest = path.join(workDir, `image-${index}-col-${column.index + 1}.png`)
        await writeFile(dest, column.png)
        columns.push({ path: dest, derived: { sourceIndex: index, column: column.index + 1 } })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.warn(`[worker] run ${job.runId}: 画像 ${index} の列分割をスキップ — ${message}`)
    }
  }
  return columns
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
      const promptImages: PromptImage[] = []
      for (const [index, image] of job.images.entries()) {
        const ext = EXT_BY_CONTENT_TYPE[image.contentType] ?? 'bin'
        const dest = path.join(workDir, `image-${index}.${ext}`)
        await api.downloadImage(job.runId, image.id, dest, job.attemptCount)
        promptImages.push({ path: dest })
      }
      // 列画像は**元画像の後ろ**に足す（images の分類は元画像の index に対して行わせる）。
      promptImages.push(...(await buildColumnImages(job, workDir, promptImages)))
      const imagePaths = promptImages.map((image) => image.path)

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
      const prompt = buildExtractionPrompt(promptImages)
      // {output} 構成では実行中もファイルサイズを監視させる（stdout 構成では監視不要）。
      const watchOutputPath = usesOutputFile(config.llmCommand) ? outputPath : undefined
      const result = await runCommand(command, prompt, config.llmTimeoutMs, watchOutputPath)

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
