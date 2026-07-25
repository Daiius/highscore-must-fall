import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 同一オリジン配信。ブラウザは常に自オリジンの /api を叩き、dev では Vite が server へ
// **パスを保持したまま**素通しで転送する（server は /api 配下にルートを持つ）。
// 本番は nginx が同じ規約で担う（`location /api/ { proxy_pass http://<server>:4000; }`）。
// ★ /api を剥がしてはいけない: better-auth は BETTER_AUTH_URL の pathname を受信パスから
//    剥がしてエンドポイントを解決するため、prefix を剥がすと /api/auth/* が全て 404 になる。
const apiTarget = process.env.DEV_API_TARGET ?? 'http://localhost:4000'

// リモート dev 公開（前段プロキシが TLS 終端＋認証を担う）でだけ必要な差分。
// PUBLIC_ORIGIN 未設定 = ローカル dev（差分なし）。設定時のみ、未知 Host の拒否を回避する
// allowedHosts と、HMR を前段プロキシ経由（wss://<host>:443）へ向ける設定を上乗せする。
const publicOrigin = process.env.PUBLIC_ORIGIN
const remoteHost = publicOrigin ? new URL(publicOrigin).hostname : undefined

// React Compiler を有効にする（.claude/rules/react.md）。
// メモ化はコンパイラに任せ、手書きの useMemo / useCallback / memo() は置かない。
// panicThreshold: 'all_errors' — コンパイルできない箇所はビルドを失敗させる。
// 黙ってバイパスされると「メモ化されている前提」の useEffect 依存配列が毎レンダー変わり、
// 再取得ループのような実行時バグになるため、静かに諦めさせない。
// react/compiler-runtime は React 19 本体に入っているので追加の runtime パッケージは要らない。
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }]],
      },
    }),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, ws: true },
    },
    ...(remoteHost
      ? {
          allowedHosts: [remoteHost],
          hmr: { clientPort: 443, protocol: 'wss' as const },
        }
      : {}),
  },
})
