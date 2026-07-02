// better-auth の設定。認証テーブル（user/session/account/verification）は database に集約されており
// drizzleAdapter で連携する（PRD 05・.claude/rules/database.md）。
//
//   - ソーシャル OAuth のみ（初手 Google）。GOOGLE_CLIENT_ID/SECRET が揃っている時だけ有効化する。
//   - MVP 動作確認用に、本番以外では email+password を有効化して dev ログインバイパスを可能にする
//     （実 Google クレデンシャル無しで Playwright E2E を通すため。導線は app.ts の /api/dev/login）。

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { account, db, session, user, verification } from 'database'

const isProd = process.env.NODE_ENV === 'production'

/** 本番では必須。本番以外は devFallback があればそれを使う（秘密情報を .env に置かず動かせる）。 */
const required = (name: string, value: string | undefined, devFallback?: string): string => {
  if (value) return value
  if (!isProd && devFallback !== undefined) return devFallback
  throw new Error(`${name} is required`)
}

const baseURL = required('BETTER_AUTH_URL', process.env.BETTER_AUTH_URL, 'http://localhost:4000')
/** web オリジン（CORS 許可・trustedOrigins 用）。 */
export const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173'

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const hasGoogle = Boolean(googleClientId && googleClientSecret)

/** dev ログインバイパスが使えるか（本番では常に無効）。app.ts の導線ガードにも使う。 */
export const isDevLoginEnabled = !isProd

export const auth = betterAuth({
  appName: 'highscore-must-fall',
  baseURL,
  secret: required(
    'BETTER_AUTH_SECRET',
    process.env.BETTER_AUTH_SECRET,
    'dev-insecure-secret-change-me',
  ),

  database: drizzleAdapter(db, {
    provider: 'mysql',
    schema: { user, session, account, verification },
  }),

  // Google クレデンシャルが揃っている時だけソーシャルログインを有効化する。
  ...(hasGoogle && {
    socialProviders: {
      google: {
        clientId: googleClientId as string,
        clientSecret: googleClientSecret as string,
      },
    },
  }),

  // 本番以外のみ email+password を有効化（dev ログインバイパスの土台）。本番では無効。
  emailAndPassword: {
    enabled: isDevLoginEnabled,
  },

  trustedOrigins: [baseURL, webOrigin],
})
