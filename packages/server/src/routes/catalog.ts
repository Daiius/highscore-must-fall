// catalog ルート（グローバル・prd/03 §5）。名寄せ表示・分析・カタログ管理（prd/08 §6）が参照する。
//
//   - GET    /api/catalog            : 名寄せサジェスト用の軽い一覧（認証済みユーザー）。
//   - GET    /api/catalog/manage     : 管理 UI 用（参照数・別名・孤児判定つき）。**admin 限定**。
//   - POST   /api/catalog/merge      : B を A に統合（旧名は alias に残る）。**admin 限定**。
//   - DELETE /api/catalog/:kind/:id  : 孤児削除（4条件を満たす行のみ）。**admin 限定**。
//
// 読み取りは認証済みユーザーに開放（カタログは客観的事実で owner を持たないが、アプリの内部 API
// なので投入・閲覧と同じ認証境界に揃える）。書き込みはグローバルなデータを全 owner ぶん書き換える
// ため admin 限定（prd/03 §5）。**verify / kind 変更 / 名前編集の API は無い**（prd/08 §5・§6）。

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  type CatalogMutationError,
  deleteOrphanCatalogEntry,
  mergeCatalogEntry,
} from '../lib/catalog-admin'
import {
  listCatalogForManagement,
  listRewardCatalog,
  listUpgradeCatalog,
} from '../lib/catalog-queries'
import { type AppEnv, requireAdmin, requireUser } from '../lib/context'

const mergeBody = z.object({
  kind: z.enum(['upgrade', 'reward']),
  /** 統合されて消える側（誤読名）。 */
  sourceId: z.uuid(),
  /** 統合先（正しい名前）。 */
  targetId: z.uuid(),
})

const entryParam = z.object({
  kind: z.enum(['upgrade', 'reward']),
  id: z.uuid(),
})

/** 失敗理由 → HTTP ステータスと日本語メッセージ。 */
const MUTATION_ERRORS: Record<CatalogMutationError, { status: 404 | 409; message: string }> = {
  not_found: { status: 404, message: 'カタログエントリが見つかりません' },
  same_entry: { status: 409, message: '同じエントリ同士は統合できません' },
  seed_protected: {
    status: 409,
    message: 'seed の名前は統合元にできません（再 seed で復活するため）',
  },
  verified_source: {
    status: 409,
    message: '裏取り済み（verified）の名前は統合元にできません',
  },
  not_orphan: {
    status: 409,
    message: '孤児ではありません（参照・別名・seed・verified のいずれかが残っています）',
  },
}

export const catalogRoute = new Hono<AppEnv>()
  .get('/', requireUser, async (c) => {
    const [upgrades, rewards] = await Promise.all([listUpgradeCatalog(), listRewardCatalog()])
    return c.json({ upgrades, rewards })
  })
  .get('/manage', requireAdmin, async (c) => {
    return c.json(await listCatalogForManagement())
  })
  .post('/merge', requireAdmin, zValidator('json', mergeBody), async (c) => {
    const { kind, sourceId, targetId } = c.req.valid('json')
    const result = await mergeCatalogEntry(kind, sourceId, targetId)
    if (!result.ok) {
      const e = MUTATION_ERRORS[result.code]
      return c.json({ ok: false, error: e.message } as const, e.status)
    }
    return c.json({ ok: true, mergedEntries: result.mergedEntries } as const)
  })
  .delete('/:kind/:id', requireAdmin, zValidator('param', entryParam), async (c) => {
    const { kind, id } = c.req.valid('param')
    const result = await deleteOrphanCatalogEntry(kind, id)
    if (!result.ok) {
      const e = MUTATION_ERRORS[result.code]
      return c.json({ ok: false, error: e.message } as const, e.status)
    }
    return c.json({ ok: true } as const)
  })
