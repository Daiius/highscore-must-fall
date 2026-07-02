// Drizzle 1.0 のリレーション定義（defineRelations）。relational query 用。
// 参考（drizzle-orm 1.0 rc の実装例）: girls-side-analysis / seseraki。
// FK 自体は schema.ts の .references() が張る。ここは query API 用の関係宣言。

import { defineRelations } from 'drizzle-orm'
import {
  account,
  catalogAlias,
  rewardCatalog,
  rewardEntry,
  run,
  runImage,
  runPayload,
  session,
  upgradeCatalog,
  upgradeEntry,
  user,
  verification,
} from './schema'

export const relations = defineRelations(
  {
    user,
    session,
    account,
    verification,
    run,
    runPayload,
    upgradeEntry,
    rewardEntry,
    upgradeCatalog,
    rewardCatalog,
    catalogAlias,
    runImage,
  },
  (r) => ({
    // --- 認証（better-auth）---
    user: {
      sessions: r.many.session(),
      accounts: r.many.account(),
      runs: r.many.run(),
    },
    session: {
      user: r.one.user({ from: r.session.userId, to: r.user.id }),
    },
    account: {
      user: r.one.user({ from: r.account.userId, to: r.user.id }),
    },

    // --- run とその子 ---
    run: {
      owner: r.one.user({ from: r.run.ownerId, to: r.user.id }),
      payload: r.one.runPayload({ from: r.run.id, to: r.runPayload.runId }),
      upgradeEntries: r.many.upgradeEntry(),
      rewardEntries: r.many.rewardEntry(),
      images: r.many.runImage(),
    },
    runPayload: {
      run: r.one.run({ from: r.runPayload.runId, to: r.run.id }),
    },
    upgradeEntry: {
      run: r.one.run({ from: r.upgradeEntry.runId, to: r.run.id }),
      catalog: r.one.upgradeCatalog({
        from: r.upgradeEntry.upgradeCatalogId,
        to: r.upgradeCatalog.id,
      }),
    },
    rewardEntry: {
      run: r.one.run({ from: r.rewardEntry.runId, to: r.run.id }),
      catalog: r.one.rewardCatalog({
        from: r.rewardEntry.rewardCatalogId,
        to: r.rewardCatalog.id,
      }),
    },
    runImage: {
      run: r.one.run({ from: r.runImage.runId, to: r.run.id }),
    },

    // --- カタログ（グローバル）---
    upgradeCatalog: {
      entries: r.many.upgradeEntry(),
    },
    rewardCatalog: {
      entries: r.many.rewardEntry(),
    },
  }),
)
