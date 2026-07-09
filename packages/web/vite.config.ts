import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
  },
})
