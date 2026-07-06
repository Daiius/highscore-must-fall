// better-auth の設定。認証テーブル（user/session/account/verification）は database に集約されており
// drizzleAdapter で連携する（PRD 05・.claude/rules/database.md）。
//
//   - ソーシャル OAuth のみ（初手 Google）。GOOGLE_CLIENT_ID/SECRET が揃っている時だけ有効化する。
//   - MVP 動作確認用に、NODE_ENV=development のときだけ email+password を有効化して dev ログインバイパスを
//     可能にする（実 Google クレデンシャル無しで Playwright E2E を通すため。導線は app.ts の /api/dev/login）。
//
// 開発機能（dev ログインバイパス・email+password・秘密のフォールバック）は `development` の明示 allowlist
// でのみ有効化する。`production` はもちろん、NODE_ENV 未設定・`test`・`staging` など「development 以外」では
// すべて無効化し、必須秘密が無ければ起動を失敗させる（fail-open を避ける。公開された非 development 環境で
// 共有 dev ユーザーとして誰でも認証できてしまう事態を防ぐ）。

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { account, db, session, user, verification } from 'database'

/** 開発機能を許すのは NODE_ENV=development のときだけ（明示 allowlist）。 */
const isDev = process.env.NODE_ENV === 'development'

/** development のみ devFallback を許す。それ以外は値が無ければ throw（起動を失敗させる）。 */
const required = (name: string, value: string | undefined, devFallback?: string): string => {
  if (value) return value
  if (isDev && devFallback !== undefined) return devFallback
  throw new Error(`${name} is required (NODE_ENV=${process.env.NODE_ENV ?? 'unset'})`)
}

const baseURL = required('BETTER_AUTH_URL', process.env.BETTER_AUTH_URL, 'http://localhost:4000')
/** web オリジン（CORS 許可・trustedOrigins 用）。 */
export const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173'

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const hasGoogle = Boolean(googleClientId && googleClientSecret)

/** dev ログインバイパスが使えるか（development 限定）。app.ts の導線ガードにも使う。 */
export const isDevLoginEnabled = isDev

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

  // user.role（機能ゲート。prd/05 §6）をセッションに載せる。input: false で
  // サインアップ入力からの自己申告を禁止する（付与は DB 直接更新のみ）。
  user: {
    additionalFields: {
      role: {
        type: ['user', 'admin'] as string[],
        required: false,
        defaultValue: 'user',
        input: false,
      },
    },
  },

  // Google クレデンシャルが揃っている時だけソーシャルログインを有効化する。
  ...(hasGoogle && {
    socialProviders: {
      google: {
        clientId: googleClientId as string,
        clientSecret: googleClientSecret as string,
      },
    },
  }),

  // development のみ email+password を有効化（dev ログインバイパスの土台）。それ以外では無効。
  emailAndPassword: {
    enabled: isDev,
  },

  trustedOrigins: [baseURL, webOrigin],
})
