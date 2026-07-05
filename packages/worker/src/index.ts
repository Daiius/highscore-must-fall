// worker エントリポイント。compose には含めず、server とは分離した実行環境のホスト上で
// `pnpm --filter worker daemon` として動かす（prd/04 §9.2。具体構成は非公開の運用メモ）。

import { loadConfig } from './config'
import { runDaemon } from './daemon'

// リポジトリルートの .env.worker があれば読む（無ければ env 注入済みの想定）。
try {
  process.loadEnvFile('../../.env.worker')
} catch {
  try {
    process.loadEnvFile('.env.worker')
  } catch {
    // env は既に注入済みの想定。
  }
}

await runDaemon(loadConfig())
