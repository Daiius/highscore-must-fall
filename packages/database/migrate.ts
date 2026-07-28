// マイグレーション適用エントリ。`drizzle-kit generate` が作った
// drizzle/<timestamp>_<name>/migration.sql を順に適用する（未適用のものだけが走る。
// 記録先は __drizzle_migrations）。
//
// **生成は drizzle-kit（dev 専用）、適用は drizzle-orm の migrator**（本番の実行時依存）。
// これにより本番イメージに drizzle-kit を入れずに適用でき、**dev と本番で適用経路が 1 本になる**
// ——本番で初めて走らせる経路が無くなる。
//
//   dev / ホストから … pnpm db:migrate      → tsx migrate.ts
//   本番イメージ内   … docker compose run   → node /app/migrate.js
//
// ⚠ **このファイルはパッケージルート直下に置く**（src/ ではない）。migrationsFolder を
// このファイルからの相対で解くため、`./drizzle` が dev では packages/database/drizzle を、
// バンドル後は /app/drizzle を指す必要がある。src/ に置くと両者がずれる。
// cwd 相対にしないのは、実行のしかた（どこから叩くか）で壊れるため。

import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { client, db } from './src/index'

const migrationsFolder = fileURLToPath(new URL('./drizzle', import.meta.url))

// 一発限りの CLI。プールの終了待ちに頼らず明示的に exit する
// （同一スタックの seseraki で、tunnel 越しだと close が返らずプロセスが終わらない事例があった）。
try {
  await migrate(db, { migrationsFolder })
  console.log('migrations applied (up to date)')
  await client.end()
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
