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
//     （@better-auth/cli generate 由来の形。参考: girls-side-analysis / drizzle-orm 1.0 rc）
//     owner_id はこの user.id を指す FK（ユーザー削除で own データを cascade 削除）。

import { randomUUID } from 'node:crypto'
import {
  boolean,
  datetime,
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

/** PK 用の cuid/uuid 既定生成。アプリ層 insert で採番する。 */
const id = () => varchar('id', { length: 36 }).primaryKey().$defaultFn(randomUUID)
/** owner_id（better-auth user.id への FK）。索引先頭＋アプリ層でも必ず条件に含める。 */
const ownerId = () =>
  varchar('owner_id', { length: 36 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })

// --- 認証テーブル（better-auth コアスキーマ）。@better-auth/cli generate 由来の形を統合。 ---
// server 側 drizzleAdapter がこれらを使う。Google OAuth のためカスタムフィールドは無し（MVP）。

export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
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
    daysSurvived: int('days_survived').notNull(),
    finalScore: int('final_score').notNull(), // 分析の主対象
    aliensDefeated: int('aliens_defeated').notNull(),
    nukesLaunched: int('nukes_launched').notNull(),
    apocalypseBonus: int('apocalypse_bonus').notNull(),
    // 非正規化（高速分析用。upgrade_entry から導出可能だが冗長保持）。
    rerollCount: int('reroll_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index('run_owner_played_at_idx').on(t.ownerId, t.playedAt),
    index('run_owner_final_score_idx').on(t.ownerId, t.finalScore),
    index('run_owner_status_idx').on(t.ownerId, t.status),
  ],
)

// --- run_payload（重い JSON を分離。1:1）。prd/03 §3.2。 ----------------------------

export const runPayload = mysqlTable('run_payload', {
  runId: varchar('run_id', { length: 36 })
    .primaryKey()
    .references(() => run.id, { onDelete: 'cascade' }),
  ownerId: ownerId(),
  // 正規スキーマ全体を丸ごと（未知項目温存・再処理/監査用）。
  rawPayload: json('raw_payload').$type<RunRecord>().notNull(),
  llmModel: varchar('llm_model', { length: 128 }),
  sourceNote: text('source_note'),
})

// --- upgrade_entry（アップグレード/リロールの順序付きエントリ）。prd/03 §3.3。 --------

export const upgradeEntry = mysqlTable(
  'upgrade_entry',
  {
    id: id(),
    ownerId: ownerId(),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
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
    index('upgrade_entry_run_idx').on(t.runId),
    index('upgrade_entry_catalog_week_idx').on(t.upgradeCatalogId, t.weekIndex),
    index('upgrade_entry_owner_catalog_idx').on(t.ownerId, t.upgradeCatalogId),
  ],
)

// --- reward_entry（リワード台帳の行）。prd/03 §3.4。 --------------------------------

export const rewardEntry = mysqlTable(
  'reward_entry',
  {
    id: id(),
    ownerId: ownerId(),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    rewardCatalogId: varchar('reward_catalog_id', { length: 36 })
      .notNull()
      .references(() => rewardCatalog.id, { onDelete: 'restrict' }),
    count: int('count').notNull(), // 発生回数
    points: int('points').notNull(), // 合計点
  },
  (t) => [
    index('reward_entry_run_idx').on(t.runId),
    index('reward_entry_owner_catalog_idx').on(t.ownerId, t.rewardCatalogId),
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
    firstSeenRunId: varchar('first_seen_run_id', { length: 36 }),
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
    firstSeenRunId: varchar('first_seen_run_id', { length: 36 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('reward_catalog_canonical_key_uidx').on(t.canonicalKey)],
)

// --- catalog_alias（別名→正規エントリの対応・マージ用）。prd/03 §3.6。 --------------
// upgrade/reward は別名前空間なので (catalog_kind, alias_key) で一意にする。
// catalog_id は kind により upgrade/reward いずれかを指すため DB レベルの FK は張らない。

export const catalogAlias = mysqlTable(
  'catalog_alias',
  {
    id: id(),
    catalogKind: mysqlEnum('catalog_kind', CATALOG_KINDS).notNull(),
    catalogId: varchar('catalog_id', { length: 36 }).notNull(), // 統合先の正規エントリ
    aliasKey: varchar('alias_key', { length: 191 }).notNull(), // 別名の正規化キー
  },
  (t) => [
    uniqueIndex('catalog_alias_kind_key_uidx').on(t.catalogKind, t.aliasKey),
    index('catalog_alias_target_idx').on(t.catalogKind, t.catalogId),
  ],
)

// --- run_image（スクショ証跡。BlobStore キー参照）。prd/03 §3.7。 --------------------
// MVP: section あたり1枚（1 run 最大3枚）は アプリ層で担保（スキーマは将来の複数枚に耐える）。

export const runImage = mysqlTable(
  'run_image',
  {
    id: id(),
    ownerId: ownerId(),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
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
  ],
)
