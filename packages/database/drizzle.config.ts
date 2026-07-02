import { defineConfig } from 'drizzle-kit'

// マイグレーション生成/適用の設定。schema は ./src/schema.ts、成果物は ./drizzle。
// 参考: 同一スタック（drizzle-orm 1.0 rc + better-auth）の実働リポ。

// .env.database があれば読む（compose/CI では env 注入のため任意）。
try {
  process.loadEnvFile('.env.database')
} catch {
  // env は既に注入済みの想定。
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'highscore_must_fall',
  },
})
