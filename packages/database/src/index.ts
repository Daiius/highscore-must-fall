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
  // Date ⇄ DATETIME のシリアライズを UTC 固定にする。プロセス TZ（compose では Asia/Tokyo）に
  // 依存すると、shared の DATETIME 範囲検証（UTC 年基準）と保存時刻帯がズレて 500 になり得る。
  // UTC で一貫させることで検証と保存を一致させ、TZ 非依存で読み書きできる。
  timezone: 'Z',
})

export const db = drizzle({ client, relations })

// カタログ名称リストの正典（DB 非依存）。server が「この行は seed 由来か」を判定するのに使う
// （seed の名前は消せない＝孤児掃除・マージの対象外。prd/08 §7）。
export * from './catalog-data'
export { relations } from './relations'
export * from './schema'
