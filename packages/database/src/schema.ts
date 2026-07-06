// Drizzle スキーマ（MySQL 8.4）。正規スキーマ（shared）に整合させる。
// テーブル定義・enum 値・インデックスの正は prd/03-data-model.md §2〜§3。
// 方針の正: ../../.claude/rules/database.md
//
//   - ユーザーデータ（run / *_entry / run_payload / run_image）は owner_id で厳格分離。
//     複合インデックスの先頭に owner_id を置く。
//   - カタログ（upgrade_catalog / reward_catalog / catalog_alias）は「ゲームの客観的事実」であり
//     グローバル（owner を持たない）。→ prd/03 §5。
//   - 認証テーブル（user/session/account/verification）は better-auth のコアスキーマ。
//     マイグレーションは database に集約する方針（AGENTS）のためここに定義し、server 側は
//     drizzleAdapter(db, { schema: { user, session, account, verification } }) で連携する。
//     （@better-auth/cli generate 由来の形。参考: drizzle-orm 1.0 rc + better-auth の実働リポ）
//     owner_id はこの user.id を指す FK（ユーザー削除で own データを cascade 削除）。

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { ENTRY_TYPES, type RunRecord } from 'shared'

// --- DB 固有の enum 値（shared に無いもの。正は prd/03 §3）。 -------------------------

/** run の確定状態（部分ドラフト許容。prd/04）。 */
export const RUN_STATUSES = ['draft', 'confirmed'] as const
/** run の来歴（どの投入ルート由来か。prd/03 §3.1）。 */
export const RUN_SOURCES = ['file_import', 'paste', 'mcp', 'api', 'screenshot_auto'] as const
/** カタログ別名の種別（upgrade/reward で名前空間が分かれる。prd/03 §3.6）。 */
export const CATALOG_KINDS = ['upgrade', 'reward'] as const
/** スクショがどの画面か（prd/03 §3.7）。 */
export const IMAGE_SECTIONS = ['result', 'upgrade_history', 'reward_ledger', 'other'] as const
/** ユーザーのロール（自動解析の機能ゲート。prd/05 §6。将来 'premium' 等を追加）。 */
export const USER_ROLES = ['user', 'admin'] as const
/** スクショ自動解析ジョブの状態（run.status とは独立。prd/03 §3.8）。 */
export const ANALYSIS_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const

/** PK 用の cuid/uuid 既定生成。アプリ層 insert で採番する。 */
const id = () => varchar('id', { length: 36 }).primaryKey().$defaultFn(randomUUID)
/** owner_id（better-auth user.id への FK）。索引先頭＋アプリ層でも必ず条件に含める。 */
const ownerId = () =>
  varchar('owner_id', { length: 36 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })

// 子テーブルの owner_id。user への直接 FK は張らず、(run_id, owner_id) の複合 FK で
// run.owner_id との一致を DB レベルで強制する（run を唯一の所有権アンカーにする）。
// これにより「他ユーザーの run に子レコードをぶら下げる」不整合を構造的に排除する。
// user 削除時は run の cascade（run→user）→ 複合 FK の cascade（子→run）で連鎖削除される。
const childOwnerId = () => varchar('owner_id', { length: 36 }).notNull()

// --- 認証テーブル（better-auth コアスキーマ）。@better-auth/cli generate 由来の形を統合。 ---
// server 側 drizzleAdapter がこれらを使う。Google OAuth のためカスタムフィールドは無し（MVP）。

export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  // 機能ゲート用ロール（prd/05 §6）。better-auth の additionalFields でセッションに載せる。
  // admin 付与は DB 直接更新（管理 UI は作らない）。
  role: mysqlEnum('role', USER_ROLES).notNull().default('user'),
  image: text('image'),
  createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { fsp: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const session = mysqlTable(
  'session',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = mysqlTable(
  'account',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { fsp: 3 }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { fsp: 3 }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

export const verification = mysqlTable(
  'verification',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

// --- run（コア・ホット行）。巨大 JSON は run_payload に分離。prd/03 §3.1。 ------------

export const run = mysqlTable(
  'run',
  {
    id: id(),
    ownerId: ownerId(),
    game: varchar('game', { length: 191 }).notNull().default('UTOPIA MUST FALL'),
    // スクショに日付が無いため既定は投入時刻（アプリが補完）。手動上書き可。
    playedAt: datetime('played_at').notNull(),
    status: mysqlEnum('status', RUN_STATUSES).notNull().default('draft'),
    source: mysqlEnum('source', RUN_SOURCES).notNull(),
    schemaVersion: varchar('schema_version', { length: 32 }).notNull(),
    // 型付きコア指標（集計・ソート用）。
    // draft は結果画面未取得の部分 run を許容するため nullable（prd/04 §3,§4）。
    // confirmed への遷移時にアプリ層が shared の RunRecord 検証で全項目の充足を必須にする
    // （DB 制約では draft/confirmed を跨ぐ NOT NULL を表現できないため。整合は prd/03 §4 と同様アプリ層）。
    daysSurvived: int('days_survived'),
    finalScore: int('final_score'), // 分析の主対象
    aliensDefeated: int('aliens_defeated'),
    nukesLaunched: int('nukes_launched'),
    apocalypseBonus: int('apocalypse_bonus'),
    // 非正規化（高速分析用。upgrade_entry から導出可能だが冗長保持）。
    rerollCount: int('reroll_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index('run_owner_played_at_idx').on(t.ownerId, t.playedAt),
    index('run_owner_final_score_idx').on(t.ownerId, t.finalScore),
    index('run_owner_status_idx').on(t.ownerId, t.status),
    // 子テーブルの (run_id, owner_id) 複合 FK の参照先。owner 一致を DB で強制するため必須。
    uniqueIndex('run_id_owner_uidx').on(t.id, t.ownerId),
  ],
)

// --- run_payload（重い JSON を分離。1:1）。prd/03 §3.2。 ----------------------------

export const runPayload = mysqlTable(
  'run_payload',
  {
    runId: varchar('run_id', { length: 36 }).primaryKey(),
    ownerId: childOwnerId(),
    // 正規スキーマ全体を丸ごと（未知項目温存・再処理/監査用）。
    rawPayload: json('raw_payload').$type<RunRecord>().notNull(),
    llmModel: varchar('llm_model', { length: 128 }),
    sourceNote: text('source_note'),
  },
  (t) => [
    // (run_id, owner_id) → run(id, owner_id)。owner 一致を強制しつつ run 削除で cascade。
    foreignKey({
      columns: [t.runId, t.ownerId],
      foreignColumns: [run.id, run.ownerId],
      name: 'run_payload_run_owner_fkey',
    }).onDelete('cascade'),
  ],
)

// --- upgrade_entry（アップグレード/リロールの順序付きエントリ）。prd/03 §3.3。 --------

export const upgradeEntry = mysqlTable(
  'upgrade_entry',
  {
    id: id(),
    ownerId: childOwnerId(),
    runId: varchar('run_id', { length: 36 }).notNull(),
    weekIndex: int('week_index').notNull(), // 1..
    orderInWeek: int('order_in_week').notNull(), // 週内の位置（reroll 含む）
    entryType: mysqlEnum('entry_type', ENTRY_TYPES).notNull(),
    // upgrade のみ。reroll は null。カタログ削除は原則マージ経由のため制限。
    upgradeCatalogId: varchar('upgrade_catalog_id', { length: 36 }).references(
      () => upgradeCatalog.id,
      { onDelete: 'restrict' },
    ),
    // アップグレードのみの通し番号（reroll は null）。「位置 N のアップグレード」分析用。
    upgradeOrder: int('upgrade_order'),
    // reroll の verbatim（灰色フレーバー・集計対象外）。
    flavorText: text('flavor_text'),
  },
  (t) => [
    // 週内位置の一意性（run 内で (week, 週内順) が重複すると取得順が復元不能）。
    // (run_id) 単独索引はこの複合 UNIQUE の左端で兼ねられるため統合。shared でも同値を
    // error 検証済み（validate.ts）だが、DB でも多層防御として強制する（prd/03 §1・§3.3）。
    uniqueIndex('upgrade_entry_run_week_order_uidx').on(t.runId, t.weekIndex, t.orderInWeek),
    // アップグレード通し番号の run 内一意性。reroll 行は upgrade_order=NULL で、MySQL の
    // UNIQUE は NULL を重複扱いしないため除外される（upgrade 行のみ実効）。
    uniqueIndex('upgrade_entry_run_upgrade_order_uidx').on(t.runId, t.upgradeOrder),
    index('upgrade_entry_catalog_week_idx').on(t.upgradeCatalogId, t.weekIndex),
    index('upgrade_entry_owner_catalog_idx').on(t.ownerId, t.upgradeCatalogId),
    // (run_id, owner_id) → run(id, owner_id)。owner 一致を強制しつつ run 削除で cascade。
    foreignKey({
      columns: [t.runId, t.ownerId],
      foreignColumns: [run.id, run.ownerId],
      name: 'upgrade_entry_run_owner_fkey',
    }).onDelete('cascade'),
    // entry_type と catalog/order の対応を強制（prd/03 §3.3）:
    // upgrade は upgrade_catalog_id・upgrade_order を持ち、reroll は両方 null。
    check(
      'upgrade_entry_type_target_chk',
      sql`(${t.entryType} = 'upgrade' and ${t.upgradeCatalogId} is not null and ${t.upgradeOrder} is not null)
        or (${t.entryType} = 'reroll' and ${t.upgradeCatalogId} is null and ${t.upgradeOrder} is null)`,
    ),
  ],
)

// --- reward_entry（リワード台帳の行）。prd/03 §3.4。 --------------------------------

export const rewardEntry = mysqlTable(
  'reward_entry',
  {
    id: id(),
    ownerId: childOwnerId(),
    runId: varchar('run_id', { length: 36 }).notNull(),
    rewardCatalogId: varchar('reward_catalog_id', { length: 36 })
      .notNull()
      .references(() => rewardCatalog.id, { onDelete: 'restrict' }),
    count: int('count').notNull(), // 発生回数
    points: int('points').notNull(), // 合計点
  },
  (t) => [
    index('reward_entry_run_idx').on(t.runId),
    index('reward_entry_owner_catalog_idx').on(t.ownerId, t.rewardCatalogId),
    // (run_id, owner_id) → run(id, owner_id)。owner 一致を強制しつつ run 削除で cascade。
    foreignKey({
      columns: [t.runId, t.ownerId],
      foreignColumns: [run.id, run.ownerId],
      name: 'reward_entry_run_owner_fkey',
    }).onDelete('cascade'),
  ],
)

// --- upgrade_catalog / reward_catalog（名寄せマスタ・グローバル）。prd/03 §3.5。 -----
// canonical_key は shared の normalizeName を通した正規形。表示にもそのまま使う。

export const upgradeCatalog = mysqlTable(
  'upgrade_catalog',
  {
    id: id(),
    canonicalKey: varchar('canonical_key', { length: 191 }).notNull(),
    displayName: varchar('display_name', { length: 191 }).notNull(),
    // 種別: contract（既定）/ opportunity_upgrade(OU)。unverified 同様、後から人手で付与/検証する属性。
    kind: mysqlEnum('kind', ['contract', 'opportunity_upgrade']).notNull().default('contract'),
    verified: boolean('verified').notNull().default(false), // 既定 false（unverified で自動登録）
    // 初出 run。run/ユーザー削除後もグローバルカタログは残すため FK は SET NULL。
    firstSeenRunId: varchar('first_seen_run_id', { length: 36 }).references(() => run.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('upgrade_catalog_canonical_key_uidx').on(t.canonicalKey)],
)

export const rewardCatalog = mysqlTable(
  'reward_catalog',
  {
    id: id(),
    canonicalKey: varchar('canonical_key', { length: 191 }).notNull(),
    displayName: varchar('display_name', { length: 191 }).notNull(),
    verified: boolean('verified').notNull().default(false),
    // 初出 run。run/ユーザー削除後もグローバルカタログは残すため FK は SET NULL。
    firstSeenRunId: varchar('first_seen_run_id', { length: 36 }).references(() => run.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('reward_catalog_canonical_key_uidx').on(t.canonicalKey)],
)

// --- catalog_alias（別名→正規エントリの対応・マージ用）。prd/03 §3.6。 --------------
// upgrade/reward は別名前空間なので (catalog_kind, alias_key) で一意にする。
// 統合先は種別により upgrade/reward いずれか。単一の polymorphic 列だと FK を張れず
// 「存在しない ID・異種カタログ ID」を保存できてしまうため、種別ごとの nullable 参照列に
// 分け、それぞれ実 FK を張る。CHECK で「kind に対応する列だけが非 null」を強制する。
// カタログ削除時は対応する alias も無意味になるため cascade。

export const catalogAlias = mysqlTable(
  'catalog_alias',
  {
    id: id(),
    catalogKind: mysqlEnum('catalog_kind', CATALOG_KINDS).notNull(),
    // kind=upgrade のとき非 null（reward は null）。統合先の正規エントリ。
    upgradeCatalogId: varchar('upgrade_catalog_id', { length: 36 }).references(
      () => upgradeCatalog.id,
      { onDelete: 'cascade' },
    ),
    // kind=reward のとき非 null（upgrade は null）。
    rewardCatalogId: varchar('reward_catalog_id', { length: 36 }).references(
      () => rewardCatalog.id,
      { onDelete: 'cascade' },
    ),
    aliasKey: varchar('alias_key', { length: 191 }).notNull(), // 別名の正規化キー
  },
  (t) => [
    uniqueIndex('catalog_alias_kind_key_uidx').on(t.catalogKind, t.aliasKey),
    index('catalog_alias_upgrade_target_idx').on(t.upgradeCatalogId),
    index('catalog_alias_reward_target_idx').on(t.rewardCatalogId),
    // 種別と非 null 列の整合を強制（upgrade↔upgrade_catalog_id / reward↔reward_catalog_id）。
    check(
      'catalog_alias_kind_target_chk',
      sql`(${t.catalogKind} = 'upgrade' and ${t.upgradeCatalogId} is not null and ${t.rewardCatalogId} is null)
        or (${t.catalogKind} = 'reward' and ${t.rewardCatalogId} is not null and ${t.upgradeCatalogId} is null)`,
    ),
  ],
)

// --- run_image（スクショ証跡。BlobStore キー参照）。prd/03 §3.7。 --------------------
// MVP: section あたり1枚（1 run 最大3枚）は アプリ層で担保（スキーマは将来の複数枚に耐える）。

export const runImage = mysqlTable(
  'run_image',
  {
    id: id(),
    ownerId: childOwnerId(),
    runId: varchar('run_id', { length: 36 }).notNull(),
    section: mysqlEnum('section', IMAGE_SECTIONS).notNull(),
    storageKey: varchar('storage_key', { length: 255 }).notNull(), // BlobStore のキー
    contentType: varchar('content_type', { length: 64 }).notNull(), // png/jpeg/webp
    byteSize: int('byte_size').notNull(),
    width: int('width'),
    height: int('height'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('run_image_run_idx').on(t.runId),
    index('run_image_owner_run_idx').on(t.ownerId, t.runId),
    // (run_id, owner_id) → run(id, owner_id)。owner 一致を強制しつつ run 削除で cascade。
    foreignKey({
      columns: [t.runId, t.ownerId],
      foreignColumns: [run.id, run.ownerId],
      name: 'run_image_run_owner_fkey',
    }).onDelete('cascade'),
  ],
)

// --- analysis_job（スクショ自動解析のジョブ状態。run と 1:1）。prd/03 §3.8・prd/04 §9。 ---
// run.status（draft/confirmed）とは独立した「現在の運用状態」。履歴は持たない
// （再解析は同一行を queued に戻す。来歴は run_payload.llm_model に残る）。
// 「解析中」「解析済み・要確認」は status × run.status から導出する。

export const analysisJob = mysqlTable(
  'analysis_job',
  {
    // 1:1 なので run_id を PK にする（run_payload と同じ形）。
    runId: varchar('run_id', { length: 36 }).primaryKey(),
    ownerId: childOwnerId(),
    status: mysqlEnum('status', ANALYSIS_JOB_STATUSES).notNull().default('queued'),
    // 再解析（人間起点の再キュー）を含む累計試行回数。claim 時にインクリメント。
    attemptCount: int('attempt_count').notNull().default(0),
    // failed の原因（UI 表示用）。
    lastError: text('last_error'),
    // claim 時に設定する処理期限。超過は failed 落とし（自動再キューしない。prd/04 §9.5）。
    leasedUntil: datetime('leased_until'),
    // 直近の実行モデル（worker が complete 時に報告）。
    llmModel: varchar('llm_model', { length: 128 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    // worker の claim（queued を古い順に1件）用。
    index('analysis_job_status_created_idx').on(t.status, t.createdAt),
    index('analysis_job_owner_status_idx').on(t.ownerId, t.status),
    // (run_id, owner_id) → run(id, owner_id)。owner 一致を強制しつつ run 削除で cascade。
    foreignKey({
      columns: [t.runId, t.ownerId],
      foreignColumns: [run.id, run.ownerId],
      name: 'analysis_job_run_owner_fkey',
    }).onDelete('cascade'),
  ],
)
