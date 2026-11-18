import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 本番イメージの「起動の仕方」を照合する（packages/server/Dockerfile.prod の runtime ステージ）。
// 本番の compose はリポジトリの外にあり、server は CMD のまま、migrate / seed は
// `command: ["node", "/app/migrate.js"]` の形で起動している。distroless の既定
// （ENTRYPOINT=/nodejs/bin/node・PATH に /nodejs/bin が無い）に戻ると、ビルドは通るのに
// migrate / seed が `node node /app/migrate.js` になって落ちる。main に入ると数分で本番に出るので、ここで止める。

const dockerfile = readFileSync(new URL('../../../Dockerfile.prod', import.meta.url), 'utf8')

function finalStage(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim())
  const lastFrom = lines.findLastIndex((l) => /^FROM\s/i.test(l))
  return lines.slice(lastFrom)
}

describe('Dockerfile.prod の runtime ステージ', () => {
  const stage = finalStage(dockerfile)

  it('ENTRYPOINT を空にしている（command を `node` から書く形を保つ）', () => {
    expect(stage).toContain('ENTRYPOINT []')
  })

  it('`node` を PATH で引ける', () => {
    const path = stage.find((l) => /^ENV\s+PATH=/.test(l))
    expect(path?.replace(/^ENV\s+PATH=/, '').split(':')).toContain('/nodejs/bin')
  })

  it('CMD が `node server.js`', () => {
    expect(stage).toContain('CMD ["node", "server.js"]')
  })

  it('migrate / seed と ESM の package.json を同梱している', () => {
    for (const file of ['./package.json', './migrate.js', './seed.js', './drizzle']) {
      expect(stage.some((l) => /^COPY\s/.test(l) && l.endsWith(` ${file}`))).toBe(true)
    }
  })
})
