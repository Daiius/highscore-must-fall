// run 保存サービス（ingestion 下流の「確定保存 API」本体）。
// 検証済みの正規レコード（shared の RunRecord）を run / run_payload / upgrade_entry /
// reward_entry へ 1 トランザクションで書き込み、未知の upgrade/reward 名は unverified で
// カタログに自動登録する（prd/03 §3・§5・prd/04 §3.6）。
//
//   - owner_id はセッション由来（呼び出し側が保証）。子テーブルは run.owner_id と一致させ、
//     (run_id, owner_id) 複合 FK による所有権強制に載せる。
//   - catalog 名寄せは正規形（canonical_key）一致 → alias → 無ければ unverified 自動登録の順。
//     RunRecord の name は shared の catalogName で正規化済みなのでそのまま key に使える。

import { randomUUID } from 'node:crypto'
import {
  analysisJob,
  catalogAlias,
  db,
  rewardCatalog,
  rewardEntry,
  run,
  runPayload,
  upgradeCatalog,
  upgradeEntry,
} from 'database'
import { and, eq } from 'drizzle-orm'
import { type RunRecord, type ValidationIssue, validateRunRecord } from 'shared'

/** MVP の投入ルート（file_import / paste のみ。他は Phase2 以降）。 */
export type IngestSource = 'file_import' | 'paste'
export type RunStatus = 'draft' | 'confirmed'

export interface SaveRunInput {
  record: RunRecord
  ownerId: string
  status: RunStatus
  source: IngestSource
  /** 明示上書き（無ければ record.played_at → 投入時刻の順で解決）。 */
  playedAt?: Date
  llmModel?: string
  sourceNote?: string
}

export interface SaveRunResult {
  runId: string
  status: RunStatus
}

/** drizzle トランザクションハンドル（db.transaction のコールバック引数型）。 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * upgrade 名（正規形）を upgrade_catalog の id へ解決する。
 * 既知（canonical_key 一致）→ 別名（catalog_alias）→ 無ければ unverified で自動登録。
 */
async function resolveUpgradeCatalogId(tx: Tx, key: string, runId: string): Promise<string> {
  const existing = await tx
    .select({ id: upgradeCatalog.id })
    .from(upgradeCatalog)
    .where(eq(upgradeCatalog.canonicalKey, key))
    .limit(1)
  if (existing[0]) return existing[0].id

  const alias = await tx
    .select({ id: catalogAlias.upgradeCatalogId })
    .from(catalogAlias)
    .where(and(eq(catalogAlias.catalogKind, 'upgrade'), eq(catalogAlias.aliasKey, key)))
    .limit(1)
  if (alias[0]?.id) return alias[0].id

  // 原子的な insert-or-get。同一未知名を含む run が同時保存されても一意制約違反で落とさない。
  // 競合時の set は canonical_key 自身への no-op（既存の display_name/first_seen を壊さない）。
  await tx
    .insert(upgradeCatalog)
    .values({
      id: randomUUID(),
      canonicalKey: key,
      displayName: key, // 正規形を表示にもそのまま使う（別の表示名を持たない）。
      verified: false, // unverified 自動登録。人手 verify/マージで育てる。
      firstSeenRunId: runId,
    })
    .onDuplicateKeyUpdate({ set: { canonicalKey: key } })
  // 再取得はロック読み取り（FOR UPDATE）。REPEATABLE READ の非ロック読みはトランザクション開始時
  // スナップショットを見るため、同時保存で他トランザクションが commit した行が見えず空になり得る。
  const inserted = await tx
    .select({ id: upgradeCatalog.id })
    .from(upgradeCatalog)
    .where(eq(upgradeCatalog.canonicalKey, key))
    .limit(1)
    .for('update')
  // 直前の upsert 後なので必ず存在する（無ければ FK 違反を招くため即エラー）。
  const id = inserted[0]?.id
  if (!id) throw new Error(`upgrade_catalog upsert failed for key: ${key}`)
  return id
}

/** reward 名（正規形）を reward_catalog の id へ解決する（upgrade と同じ順序）。 */
async function resolveRewardCatalogId(tx: Tx, key: string, runId: string): Promise<string> {
  const existing = await tx
    .select({ id: rewardCatalog.id })
    .from(rewardCatalog)
    .where(eq(rewardCatalog.canonicalKey, key))
    .limit(1)
  if (existing[0]) return existing[0].id

  const alias = await tx
    .select({ id: catalogAlias.rewardCatalogId })
    .from(catalogAlias)
    .where(and(eq(catalogAlias.catalogKind, 'reward'), eq(catalogAlias.aliasKey, key)))
    .limit(1)
  if (alias[0]?.id) return alias[0].id

  // 原子的な insert-or-get（upgrade 側と同じ理由・同じ形）。
  await tx
    .insert(rewardCatalog)
    .values({
      id: randomUUID(),
      canonicalKey: key,
      displayName: key,
      verified: false,
      firstSeenRunId: runId,
    })
    .onDuplicateKeyUpdate({ set: { canonicalKey: key } })
  // 再取得はロック読み取り（upgrade 側と同じ理由）。
  const inserted = await tx
    .select({ id: rewardCatalog.id })
    .from(rewardCatalog)
    .where(eq(rewardCatalog.canonicalKey, key))
    .limit(1)
    .for('update')
  const id = inserted[0]?.id
  if (!id) throw new Error(`reward_catalog upsert failed for key: ${key}`)
  return id
}

/** 事前解決したカタログ id マップから必ず存在する id を引く（欠落は実装バグなので即エラー）。 */
function mustGet(map: Map<string, string>, key: string): string {
  const id = map.get(key)
  if (!id) throw new Error(`catalog id not resolved for key: ${key}`)
  return id
}

/** InnoDB のデッドロック(1213)・ロック待ちタイムアウト(1205)は限定的に再試行する。 */
const RETRYABLE_ERRNOS = new Set([1213, 1205])

export async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      const errno = (e as { errno?: number }).errno
      if (errno !== undefined && RETRYABLE_ERRNOS.has(errno)) {
        lastErr = e // 犠牲になった側はロールバック済み。runId 再利用で再試行して問題ない。
        continue
      }
      throw e
    }
  }
  throw lastErr
}

/**
 * カタログ解決 + upgrade_entry / reward_entry の書き込み（既存 run への追記部分）。
 * saveRun（新規 run 保存）とスクショ自動解析の completeJob（既存 run への反映）が共有する。
 * 呼び出し側が run / run_payload 行と、（再反映時は）既存エントリの削除を用意すること。
 */
export async function writeRunChildren(
  tx: Tx,
  args: { record: RunRecord; runId: string; ownerId: string },
): Promise<void> {
  const { record, runId, ownerId } = args
  // 未知カタログの upsert を run 間で決定的な順序（canonical_key 昇順・upgrade→reward）で行うために、
  // 事前に名前を dedupe & ソートしておく。ロック取得順を全 run で揃え、逆順ロックによるデッドロックを防ぐ。
  const upgradeKeys = [
    ...new Set(record.upgrade_history.flatMap((e) => (e.entry_type === 'upgrade' ? [e.name] : []))),
  ].sort()
  const rewardKeys = [...new Set(record.reward_ledger.map((r) => r.name))].sort()

  // カタログを決定的順序で解決して id マップを作る（ここでロックが確定する）。
  const upgradeIdByKey = new Map<string, string>()
  for (const key of upgradeKeys) {
    upgradeIdByKey.set(key, await resolveUpgradeCatalogId(tx, key, runId))
  }
  const rewardIdByKey = new Map<string, string>()
  for (const key of rewardKeys) {
    rewardIdByKey.set(key, await resolveRewardCatalogId(tx, key, runId))
  }

  // upgrade_entry（配列順を保ちつつ upgrade 通し番号を採番。catalog id はマップ引き）。
  let upgradeOrder = 0
  for (const entry of record.upgrade_history) {
    if (entry.entry_type === 'upgrade') {
      upgradeOrder += 1
      await tx.insert(upgradeEntry).values({
        id: randomUUID(),
        ownerId,
        runId,
        weekIndex: entry.week_index,
        orderInWeek: entry.order_in_week,
        entryType: 'upgrade',
        upgradeCatalogId: mustGet(upgradeIdByKey, entry.name),
        upgradeOrder,
      })
    } else {
      await tx.insert(upgradeEntry).values({
        id: randomUUID(),
        ownerId,
        runId,
        weekIndex: entry.week_index,
        orderInWeek: entry.order_in_week,
        entryType: 'reroll',
        flavorText: entry.flavor_text,
      })
    }
  }

  // reward_entry。
  for (const r of record.reward_ledger) {
    await tx.insert(rewardEntry).values({
      id: randomUUID(),
      ownerId,
      runId,
      rewardCatalogId: mustGet(rewardIdByKey, r.name),
      count: r.count,
      points: r.points,
    })
  }
}

/** upgrade_history から reroll 数を数える（run.reroll_count の非正規化用）。 */
export function countRerolls(record: RunRecord): number {
  return record.upgrade_history.filter((e) => e.entry_type === 'reroll').length
}

/**
 * 検証済み RunRecord を保存する。呼び出し側は事前に shared で検証し、
 * confirmed なら error 無しを保証していること（ここでは DB 書き込みに専念する）。
 */
export async function saveRun(input: SaveRunInput): Promise<SaveRunResult> {
  const { record, ownerId, status, source } = input
  const runId = randomUUID()
  const playedAt = input.playedAt ?? (record.played_at ? new Date(record.played_at) : new Date())

  await withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      // run（コア・ホット行）。カタログの firstSeenRunId FK があるため先に入れる。
      await tx.insert(run).values({
        id: runId,
        ownerId,
        game: record.game,
        playedAt,
        status,
        source,
        schemaVersion: record.schema_version,
        daysSurvived: record.result.days_survived,
        finalScore: record.result.final_score,
        aliensDefeated: record.result.aliens_defeated,
        nukesLaunched: record.result.nukes_launched,
        apocalypseBonus: record.result.apocalypse_bonus,
        rerollCount: countRerolls(record),
      })

      // run_payload（正規スキーマ全体を丸ごと温存）。
      await tx.insert(runPayload).values({
        runId,
        ownerId,
        rawPayload: record,
        llmModel: input.llmModel,
        sourceNote: input.sourceNote,
      })

      await writeRunChildren(tx, { record, runId, ownerId })
    }),
  )

  return { runId, status }
}

export type UpdateRunRecordResult =
  | { kind: 'not_found' }
  | { kind: 'run_not_draft' }
  | { kind: 'analysis_in_progress' }
  | { kind: 'updated' }

/**
 * draft の中身を検証済み RunRecord で丸ごと置き換える（手動修正。prd/04 §4）。
 * 子エントリは削除して writeRunChildren で書き直す（completeJob の再反映と同じ形）。
 *
 *   - draft のみ。confirmed は「下書きに戻す」を経由させる（確定済みの内容を黙って変えない）。
 *   - 解析待ち/解析中は拒否する。worker の complete が同じ行を上書きするため（updateRunStatus と同様、
 *     UI でもボタンを止めるが backend で確実に弾く）。
 *   - run.played_at は触らない。投入日時の変更は投入時のみの導線であり、
 *     ここで raw_payload の played_at からコピーすると POST 時の明示上書きを黙って捨てるため。
 */
export async function updateRunRecord(
  ownerId: string,
  runId: string,
  record: RunRecord,
): Promise<UpdateRunRecordResult> {
  return withDeadlockRetry(() =>
    db.transaction(async (tx): Promise<UpdateRunRecordResult> => {
      // run → job の順で行ロックする（completeJob / updateRunStatus と同順でデッドロック回避）。
      const rows = await tx
        .select({ status: run.status })
        .from(run)
        .where(and(eq(run.id, runId), eq(run.ownerId, ownerId)))
        .limit(1)
        .for('update')
      const current = rows[0]
      if (!current) return { kind: 'not_found' }
      if (current.status !== 'draft') return { kind: 'run_not_draft' }

      const jobRows = await tx
        .select({ status: analysisJob.status })
        .from(analysisJob)
        .where(and(eq(analysisJob.runId, runId), eq(analysisJob.ownerId, ownerId)))
        .limit(1)
        .for('update')
      const jobStatus = jobRows[0]?.status
      if (jobStatus === 'queued' || jobStatus === 'running') {
        return { kind: 'analysis_in_progress' }
      }

      await tx
        .update(run)
        .set({
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

      // 行が無い run（想定外）でも復旧できるよう upsert。llm_model / source_note は来歴なので温存する。
      await tx
        .insert(runPayload)
        .values({ runId, ownerId, rawPayload: record })
        .onDuplicateKeyUpdate({ set: { rawPayload: record } })

      await tx
        .delete(upgradeEntry)
        .where(and(eq(upgradeEntry.runId, runId), eq(upgradeEntry.ownerId, ownerId)))
      await tx
        .delete(rewardEntry)
        .where(and(eq(rewardEntry.runId, runId), eq(rewardEntry.ownerId, ownerId)))
      await writeRunChildren(tx, { record, runId, ownerId })

      return { kind: 'updated' }
    }),
  )
}

export type UpdateRunStatusResult =
  | { kind: 'not_found' }
  | { kind: 'invalid'; issues: ValidationIssue[] }
  | { kind: 'analysis_in_progress' }
  | { kind: 'updated'; status: RunStatus; issues: ValidationIssue[] }

/**
 * run の status を遷移させる（prd/04 §4）。
 *   - draft → confirmed: 保存済み raw_payload を現行契約で再検証し、error があれば遷移しない。
 *     現状の draft は error なしでしか保存できないためほぼ素通りだが、部分ドラフト
 *     （緩い draft 契約）導入後もこの再検証が確定条件を保つ。
 *     解析中（analysis_job が queued/running）の run は、中身が未確定なので確定を拒否する
 *     （worker の complete と競合させない。frontend でもボタンを止めるが backend で確実に弾く）。
 *   - confirmed → draft（再ドラフト）: 修正作業用。検証なしで戻す。
 * 同じ status への遷移は冪等に成功。
 */
export async function updateRunStatus(
  ownerId: string,
  runId: string,
  status: RunStatus,
): Promise<UpdateRunStatusResult> {
  return withDeadlockRetry(() =>
    db.transaction(async (tx): Promise<UpdateRunStatusResult> => {
      // run → job の順で行ロックする（completeJob / requeueAnalysis と同順でデッドロック回避）。
      // 判定〜更新の間に worker の claim / complete が割り込むのを防ぐ。
      const rows = await tx
        .select({ status: run.status })
        .from(run)
        .where(and(eq(run.id, runId), eq(run.ownerId, ownerId)))
        .limit(1)
        .for('update')
      const current = rows[0]
      if (!current) return { kind: 'not_found' }
      if (current.status === status) return { kind: 'updated', status, issues: [] }

      let issues: ValidationIssue[] = []
      if (status === 'confirmed') {
        // 解析中は確定不可（自動解析 run のみ analysis_job を持つ。手動 run は素通り）。
        const jobRows = await tx
          .select({ status: analysisJob.status })
          .from(analysisJob)
          .where(and(eq(analysisJob.runId, runId), eq(analysisJob.ownerId, ownerId)))
          .limit(1)
          .for('update')
        const jobStatus = jobRows[0]?.status
        if (jobStatus === 'queued' || jobStatus === 'running') {
          return { kind: 'analysis_in_progress' }
        }

        const payloadRows = await tx
          .select({ rawPayload: runPayload.rawPayload })
          .from(runPayload)
          .where(and(eq(runPayload.runId, runId), eq(runPayload.ownerId, ownerId)))
          .limit(1)
        // payload 欠落（想定外）も Zod エラーとして invalid に落ちる。
        const result = validateRunRecord(payloadRows[0]?.rawPayload)
        if (!result.ok) return { kind: 'invalid', issues: result.issues }
        issues = result.issues
      }

      await tx
        .update(run)
        .set({ status })
        .where(and(eq(run.id, runId), eq(run.ownerId, ownerId)))
      return { kind: 'updated', status, issues }
    }),
  )
}
