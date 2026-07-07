// 本番 server イメージ用のバンドル設定。
// server の src と workspace 依存（shared / database は .ts を exports する）を
// 単一の ESM ファイル dist/server.js にまとめる。開発は tsx で直接実行するが、
// 本番はバンドルして依存解決とツール（tsx）をランタイムから排除する。
// 参考: ~/sources/seseraki, ~/sources/girls-side-analysis（同一スタックの実働構成）。

import { build } from 'esbuild'

await build({
  entryPoints: ['./src/index.ts'],
  outfile: './dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  // sharp はネイティブ addon（.node バイナリ）を含むためバンドルできない。
  // external にして、ランタイム側で linux/amd64 向けに実体を導入する（Dockerfile.prod）。
  external: ['sharp'],
  // ESM 出力に require / __dirname / __filename を用意する。
  // バンドルに含まれる CJS 依存（mysql2 等）が実行時にこれらを参照するため必須。
  banner: {
    js: [
      "import { createRequire } from 'module'",
      "import { fileURLToPath } from 'url'",
      "import { dirname } from 'path'",
      'const require = createRequire(import.meta.url)',
      'const __filename = fileURLToPath(import.meta.url)',
      'const __dirname = dirname(__filename)',
    ].join('\n'),
  },
})

console.log('[esbuild] dist/server.js を生成しました')
