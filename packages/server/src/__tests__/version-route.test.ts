// `GET /api/version`（prd/02 §9.3）: 認証なし・DB に触れずに、イメージの ENV から入れた版を返す。
//
// app.ts は import した時点の env で版を読むので、env を差し替えてからモジュールを読み直す。
// 認証は差し替える（セッションの取得が呼ばれないこと＝DB に触れないことを確かめるため。DB には繋がない）。

import { afterEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn(async () => null)

vi.mock('../lib/auth', () => ({
  auth: { api: { getSession }, handler: () => new Response(null, { status: 404 }) },
  isDevLoginEnabled: false,
  webOrigin: 'http://localhost:5173',
}))

const keys = ['GIT_COMMIT', 'BUILD_TIME', 'GIT_DIRTY'] as const
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))

function setEnv(env: Record<string, string | undefined>) {
  for (const k of keys) delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
}

async function loadApp(env: Record<string, string | undefined>) {
  setEnv(env)
  vi.resetModules()
  getSession.mockClear()
  const { app } = await import('../app')
  return app
}

afterEach(() => setEnv(saved))

const sha = 'aa0922b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7'

describe('GET /api/version', () => {
  it('ビルド引数の値を返す', async () => {
    const app = await loadApp({
      GIT_COMMIT: sha,
      BUILD_TIME: '2026-10-30T01:02:03Z',
      GIT_DIRTY: 'true',
    })
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      commit: sha,
      builtAt: '2026-10-30T01:02:03.000Z',
      dirty: true,
    })
  })

  it('ビルド引数が無ければ unknown', async () => {
    const app = await loadApp({})
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ commit: 'unknown', builtAt: 'unknown', dirty: false })
  })

  it('cookie が付いていてもセッションを取りに行かない（DB に触れない）', async () => {
    const app = await loadApp({})
    const res = await app.request('/api/version', { headers: { cookie: 'session=whatever' } })
    expect(res.status).toBe(200)
    expect(getSession).not.toHaveBeenCalled()

    // 対照: ほかの経路はセッションを取りに行く（差し替えが効いていることの確認）。
    await app.request('/api/health')
    expect(getSession).toHaveBeenCalledTimes(1)
  })
})
