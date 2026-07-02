// database: Drizzle スキーマ・DB クライアントのエントリポイント。
// server/worker はここから db / schema / relations を import する。
// スキーマ定義は ./schema、リレーションは ./relations。方針: ../../.claude/rules/database.md

import { drizzle } from 'drizzle-orm/mysql2'
import { createPool, type Pool } from 'mysql2'
import { relations } from './relations'

// .env.database があれば読み込む（compose 実行時は env が注入されるため任意）。
// Node 22+ の組み込み。ファイル未存在時は throw するので握りつぶす。
try {
  process.loadEnvFile('.env.database')
} catch {
  // 環境変数が既に注入されている想定（docker compose / CI）。
}

export const client: Pool = createPool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE ?? 'highscore_must_fall',
})

export const db = drizzle({ client, relations })

export { relations } from './relations'
export * from './schema'
