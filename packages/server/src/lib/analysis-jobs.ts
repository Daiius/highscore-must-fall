// スクショ自動解析のジョブサービス層（prd/04 §9）。
//
//   - createScreenshotSubmission: アップロード → 空 draft run + run_image + queued job。
//   - claimNextJob / failJob / completeJob: worker API の実体。complete は
//     抽出 → フラット形 → 正規変換 → shared 検証 → run 反映 → 自動確定ゲート、まで一気通貫。
//   - requeueAnalysis: 人間起点の再解析（同一 job 行を queued に戻す再キュー方式）。
//
// ジョブは run と 1:1 の「現在の運用状態」。失敗の自動リトライはしない（prd/04 §9.5）。

import { randomUUID } from 'node:crypto'
import {
  analysisJob,
  catalogAlias,
  db,
  rewardCatalog,
  rewardEntry,
  run,
  runImage,
  runPayload,
  upgradeCatalog,
  upgradeEntry,
} from 'database'
import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import {
  type ExtractionSection,
  extractionToFlatRecord,
  SCHEMA_VERSION,
  type ScreenshotExtraction,
  type ValidationIssue,
  validateRunRecord,
} from 'shared'
import { blobStore } from './blob-store'
import { toCanonicalRunRecord } from './ingest'
import { countRerolls, withDeadlockRetry, writeRunChildren } from './runs'

/** claim 後の処理期限。超過は failed 落とし（自動再キューしない。prd/04 §9.5）。 */
const LEASE_MINUTES = 30
/** last_error の格納上限（MySQL TEXT 65535 バイトに収める・UI 表示にも十分）。 */
const LAST_ERROR_MAX_CHARS = 4000

export type AnalysisJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

const truncateError = (message: string): string =>
  message.length <= LAST_ERROR_MAX_CHARS ? message : `${message.slice(0, LAST_ERROR_MAX_CHARS)}…`

// --- 投入（アップロード → 空 draft run + images + queued job）--------------------------

export interface SubmissionImage {
  data: Buffer
  contentType: string
  ext: string
  width: number
  height: number
}

/**
 * スクショ一式を受け付ける。blob を先に置いてから DB を書き、DB 失敗時は blob を
 * ベストエフォートで掃除する（逆順だと「実体の無い画像メタ」が残り配信 500 になるため）。
 */
export async function createScreenshotSubmission(
  ownerId: string,
  images: SubmissionImage[],
): Promise<{ runId: string }> {
  const runId = randomUUID()
  const stored = images.map((image) => {
    const imageId = randomUUID()
    return { imageId, storageKey: `runs/${runId}/${imageId}.${image.ext}`, image }
  })

  for (const { storageKey, image } of stored) {
    await blobStore.put(storageKey, image.data, image.contentType)
  }
  try {
    await db.transaction(async (tx) => {
      // 空の draft run（コア指標 NULL）。played_at は投入時刻（解析結果に日時は無い）。
      await tx.insert(run).values({
        id: runId,
        ownerId,
        playedAt: new Date(),
        status: 'draft',
        source: 'screenshot_auto',
        schemaVersion: SCHEMA_VERSION,
      })
      for (const { imageId, storageKey, image } of stored) {
        await tx.insert(runImage).values({
          id: imageId,
          ownerId,
          runId,
          section: 'other', // 解析結果の分類で埋め戻す（prd/04 §9.1）。
          storageKey,
          contentType: image.contentType,
          byteSize: image.data.byteLength,
          width: image.width,
          height: image.height,
        })
      }
      await tx.insert(analysisJob).values({ runId, ownerId })
    })
  } catch (e) {
    await Promise.allSettled(stored.map(({ storageKey }) => blobStore.delete(storageKey)))
    throw e
  }
  return { runId }
}

// --- worker: claim ---------------------------------------------------------------------

export interface ClaimedJob {
  runId: string
  attemptCount: number
  images: { id: string; contentType: string; byteSize: number }[]
}

/**
 * queued のジョブを 1 件、排他的に running へ遷移して返す（無ければ null）。
 * 前段で lease 超過の running を failed に落とす（クラッシュした worker の回収。再キューはしない）。
 */
export async function claimNextJob(): Promise<ClaimedJob | null> {
  await db
    .update(analysisJob)
    .set({
      status: 'failed',
      lastError: '処理期限（lease）を超過しました。worker の状態を確認して再解析してください。',
      leasedUntil: null,
    })
    .where(and(eq(analysisJob.status, 'running'), lt(analysisJob.leasedUntil, new Date())))

  return withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const candidates = await tx
        .select({ runId: analysisJob.runId, attemptCount: analysisJob.attemptCount })
        .from(analysisJob)
        .where(eq(analysisJob.status, 'queued'))
        .orderBy(asc(analysisJob.createdAt))
        .limit(1)
        .for('update', { skipLocked: true })
      const job = candidates[0]
      if (!job) return null

      await tx
        .update(analysisJob)
        .set({
          status: 'running',
          attemptCount: job.attemptCount + 1,
          leasedUntil: new Date(Date.now() + LEASE_MINUTES * 60 * 1000),
          lastError: null,
        })
        .where(eq(analysisJob.runId, job.runId))

      const images = await tx
        .select({
          id: runImage.id,
          contentType: runImage.contentType,
          byteSize: runImage.byteSize,
        })
        .from(runImage)
        .where(eq(runImage.runId, job.runId))
        .orderBy(asc(runImage.id))
      return { runId: job.runId, attemptCount: job.attemptCount + 1, images }
    }),
  )
}

/** worker がダウンロードする画像（running ジョブの run に属するもののみ）。 */
export async function getJobImage(runId: string, imageId: string) {
  const rows = await db
    .select({ storageKey: runImage.storageKey, contentType: runImage.contentType })
    .from(runImage)
    .innerJoin(analysisJob, eq(analysisJob.runId, runImage.runId))
    .where(
      and(eq(runImage.id, imageId), eq(runImage.runId, runId), eq(analysisJob.status, 'running')),
    )
    .limit(1)
  return rows[0] ?? null
}

// --- worker: fail ----------------------------------------------------------------------

/** running のジョブを failed にする（worker からのエラー報告）。対象が無ければ false。 */
export async function failJob(runId: string, message: string): Promise<boolean> {
  const [header] = await db
    .update(analysisJob)
    .set({ status: 'failed', lastError: truncateError(message), leasedUntil: null })
    .where(and(eq(analysisJob.runId, runId), eq(analysisJob.status, 'running')))
  return header.affectedRows > 0
}

// --- worker: complete（解析結果の反映 + 自動確定ゲート）--------------------------------

export interface CompletedImageSection {
  id: string
  section: ExtractionSection
}

export type CompleteJobResult =
  | { kind: 'not_running' }
  | { kind: 'invalid_record'; issues: ValidationIssue[] }
  | { kind: 'completed'; status: 'draft' | 'confirmed'; issues: ValidationIssue[] }

/**
 * 自動確定ゲート（prd/04 §9.4）の「全 section 揃い」判定。
 * result / upgrade_history / reward_ledger が各 1 枚以上に分類されていること。
 */
function hasAllSections(imageSections: CompletedImageSection[]): boolean {
  const sections = new Set(imageSections.map((i) => i.section))
  return sections.has('result') && sections.has('upgrade_history') && sections.has('reward_ledger')
}

/** 名前群がすべて verified カタログ（正規キー一致 or 別名経由）に解決できるか。 */
async function allNamesVerified(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  upgradeKeys: string[],
  rewardKeys: string[],
): Promise<boolean> {
  const verifiedKeys = async (
    keys: string[],
    catalog: typeof upgradeCatalog | typeof rewardCatalog,
    kind: 'upgrade' | 'reward',
  ): Promise<Set<string>> => {
    if (keys.length === 0) return new Set()
    const aliasTarget =
      kind === 'upgrade' ? catalogAlias.upgradeCatalogId : catalogAlias.rewardCatalogId
    const [direct, viaAlias] = await Promise.all([
      tx
        .select({ key: catalog.canonicalKey })
        .from(catalog)
        .where(and(inArray(catalog.canonicalKey, keys), eq(catalog.verified, true))),
      tx
        .select({ key: catalogAlias.aliasKey })
        .from(catalogAlias)
        .innerJoin(catalog, eq(aliasTarget, catalog.id))
        .where(
          and(
            eq(catalogAlias.catalogKind, kind),
            inArray(catalogAlias.aliasKey, keys),
            eq(catalog.verified, true),
          ),
        ),
    ])
    return new Set([...direct.map((r) => r.key), ...viaAlias.map((r) => r.key)])
  }

  const [upgradeVerified, rewardVerified] = await Promise.all([
    verifiedKeys(upgradeKeys, upgradeCatalog, 'upgrade'),
    verifiedKeys(rewardKeys, rewardCatalog, 'reward'),
  ])
  return (
    upgradeKeys.every((k) => upgradeVerified.has(k)) &&
    rewardKeys.every((k) => rewardVerified.has(k))
  )
}

/**
 * worker の解析結果を run へ反映する。
 *   1. 抽出（フラット形）→ 正規変換 → shared 検証。error があればジョブを failed にする
 *      （幻覚値の混入より欠落を明示する方針。部分ドラフト保存は緩い draft 契約の導入後）。
 *   2. run コア列・payload・エントリを反映し、run_image.section を埋め戻す。
 *   3. 自動確定ゲート: error なし（1 で保証）・warning なし・全 section 揃い・全名称 verified
 *      をすべて満たすときだけ confirmed。それ以外は draft（人間がレビューして確定）。
 */
export async function completeJob(
  runId: string,
  extraction: ScreenshotExtraction,
  imageSections: CompletedImageSection[],
  llmModel?: string,
): Promise<CompleteJobResult> {
  const jobRows = await db
    .select({ status: analysisJob.status, ownerId: analysisJob.ownerId })
    .from(analysisJob)
    .where(eq(analysisJob.runId, runId))
    .limit(1)
  const job = jobRows[0]
  if (job?.status !== 'running') return { kind: 'not_running' }
  const ownerId = job.ownerId

  const canonical = toCanonicalRunRecord(extractionToFlatRecord(extraction))
  const validation = validateRunRecord(canonical)
  if (!validation.ok || !validation.record) {
    const summary = validation.issues
      .filter((i) => i.level === 'error')
      .map((i) => `${i.path.join('.') || '-'}: ${i.message}`)
      .join('\n')
    await db
      .update(analysisJob)
      .set({
        status: 'failed',
        lastError: truncateError(`解析結果が検証を通りませんでした:\n${summary}`),
        leasedUntil: null,
        llmModel,
      })
      .where(and(eq(analysisJob.runId, runId), eq(analysisJob.status, 'running')))
    return { kind: 'invalid_record', issues: validation.issues }
  }
  const record = validation.record
  const warnings = validation.issues.filter((i) => i.level === 'warning')

  const status = await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      // 自動確定ゲート（unverified 自動登録より先に判定する）。
      const upgradeKeys = [
        ...new Set(
          record.upgrade_history.flatMap((e) => (e.entry_type === 'upgrade' ? [e.name] : [])),
        ),
      ]
      const rewardKeys = [...new Set(record.reward_ledger.map((r) => r.name))]
      const autoConfirm =
        warnings.length === 0 &&
        hasAllSections(imageSections) &&
        (await allNamesVerified(tx, upgradeKeys, rewardKeys))
      const nextStatus: 'draft' | 'confirmed' = autoConfirm ? 'confirmed' : 'draft'

      // run コア列を反映（played_at はアップロード時刻のまま。手動上書きは既存導線）。
      await tx
        .update(run)
        .set({
          status: nextStatus,
          schemaVersion: record.schema_version,
          game: record.game,
          daysSurvived: record.result.days_survived,
          finalScore: record.result.final_score,
          aliensDefeated: record.result.aliens_defeated,
          nukesLaunched: record.result.nukes_launched,
          apocalypseBonus: record.result.apocalypse_bonus,
          rerollCount: countRerolls(record),
        })
        .where(and(eq(run.id, runId), eq(run.ownerId, ownerId)))

      // payload は再解析で上書きされ得るため upsert。
      await tx
        .insert(runPayload)
        .values({ runId, ownerId, rawPayload: record, llmModel })
        .onDuplicateKeyUpdate({
          set: { rawPayload: record, llmModel: llmModel ?? null },
        })

      // 再解析で残っている前回のエントリを消してから書き直す。
      await tx.delete(upgradeEntry).where(eq(upgradeEntry.runId, runId))
      await tx.delete(rewardEntry).where(eq(rewardEntry.runId, runId))
      await writeRunChildren(tx, { record, runId, ownerId })

      // section の埋め戻し（この run の画像のみ・worker の分類結果で更新）。
      for (const image of imageSections) {
        await tx
          .update(runImage)
          .set({ section: image.section })
          .where(and(eq(runImage.id, image.id), eq(runImage.runId, runId)))
      }

      await tx
        .update(analysisJob)
        .set({ status: 'succeeded', lastError: null, leasedUntil: null, llmModel })
        .where(eq(analysisJob.runId, runId))

      return nextStatus
    }),
  )

  return { kind: 'completed', status, issues: warnings }
}

// --- 再解析（人間起点の再キュー）--------------------------------------------------------

export type RequeueResult = 'not_found' | 'run_not_draft' | 'already_running' | 'queued'

/**
 * 同一 job 行を queued に戻す（1:1・再キュー方式。prd/04 §9.1）。
 * run が draft のときのみ（confirmed は「下書きに戻す」を経由）。running 中は拒否。
 */
export async function requeueAnalysis(ownerId: string, runId: string): Promise<RequeueResult> {
  const rows = await db
    .select({ jobStatus: analysisJob.status, runStatus: run.status })
    .from(analysisJob)
    .innerJoin(run, eq(analysisJob.runId, run.id))
    .where(and(eq(analysisJob.runId, runId), eq(analysisJob.ownerId, ownerId)))
    .limit(1)
  const current = rows[0]
  if (!current) return 'not_found'
  if (current.runStatus !== 'draft') return 'run_not_draft'
  if (current.jobStatus === 'running') return 'already_running'
  if (current.jobStatus === 'queued') return 'queued' // 冪等。

  await db
    .update(analysisJob)
    .set({ status: 'queued', lastError: null, leasedUntil: null })
    .where(and(eq(analysisJob.runId, runId), eq(analysisJob.ownerId, ownerId)))
  return 'queued'
}

/** run 削除時の blob 掃除用に storage key 一覧を返す。 */
export async function listRunImageKeys(ownerId: string, runId: string): Promise<string[]> {
  const rows = await db
    .select({ storageKey: runImage.storageKey })
    .from(runImage)
    .where(and(eq(runImage.runId, runId), eq(runImage.ownerId, ownerId)))
  return rows.map((r) => r.storageKey)
}
