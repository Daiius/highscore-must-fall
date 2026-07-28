// 本番イメージ用のバンドル設定（migrate / seed）。
//
// マイグレーションと seed は **server と同じイメージに同梱する**。理由はポートを開けずに
// 済むことではなく、**適用する SQL / カタログとコードのバージョンが構造的に一致する**こと。
// 外部から流す方式は「手元にある SQL を、本番で動いているイメージへ流す」ことになり、
// 両者がずれても何も警告されない。同じイメージの中身ならずれが原理的に起きない。
//
// エントリは 2 つ。どちらも packages/server/Dockerfile.prod が runtime へ COPY する:
//
//   migrate.ts   … マイグレーションの適用（drizzle-orm の migrator）
//   src/seed.ts  … 初期カタログの投入（冪等な upsert）
//
// server 側のバンドル（packages/server/esbuild.config.ts）とは別物で、同じ設定を共有しない。
// **どちらも `pnpm -r build`（ルートの build）で回る**ので、検証チェーンの変更は要らない。
//
// 出力の拡張子は `.js` のまま。runtime イメージ（node:22-slim）は `{"type":"module"}` の
// package.json を持つため、ESM と認識される（distroless で package.json を置けない clip とは
// 事情が違うので、`.mjs` にする必要はない）。

import { build } from 'esbuild'

await build({
  // ⚠ **エントリは名前付きで渡す。** 配列で渡すと出力先が入力の共通ベースからの相対になり、
  // migrate.ts と src/seed.ts が別階層にあるため dist/src/seed.js に落ちる。
  entryPoints: { migrate: './migrate.ts', seed: './src/seed.ts' },
  outdir: './dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
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

console.log('[esbuild] dist/migrate.js, dist/seed.js を生成しました')
