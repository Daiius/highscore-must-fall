# ルール: TypeScript / コードスタイル

## 言語・構成
- フルスタック TypeScript。ESM（`"type": "module"`）。`tsconfig.base.json` を各パッケージで extends。
- `strict` 前提。`noUncheckedIndexedAccess` 等も有効。型の `any` 逃げは原則禁止（やむを得ない場合はコメントで理由）。
- パッケージ間参照は workspace 依存（`workspace:*`）。共有物は必ず `shared` 経由（型の重複定義を作らない）。

## Lint / Format（Biome）
- **Biome を単一ツール**として使う（ESLint / Prettier は入れない）。設定は `biome.json`。
- フォーマット: スペース2 / 行幅100 / シングルクォート / セミコロンは必要時のみ / 末尾カンマ all。
- コミット前に `biome check --write`（git 2.55+ の config ベース hooks。詳細は [commit.md](./commit.md)）。CI でも `pnpm check`。

### Tailwind クラスの並べ替え（重要）
- `prettier-plugin-tailwindcss` は **使えない**。Biome の **`useSortedClasses`**（nursery, `biome.json` で有効化済み）で整列する。
- 動的クラス結合は `clsx` / `cn` / `cva` を使う（`useSortedClasses` の `functions` に登録済み）。

## 命名
- ファイル/ディレクトリ: kebab-case。型/コンポーネント: PascalCase。変数/関数: camelCase。定数: UPPER_SNAKE は避け、`as const` を優先。
- React コンポーネントファイルは PascalCase（例外）。

## テスト
- **Vitest**。`shared` のスキーマ・整合チェック・名寄せ正規化はユニットテスト必須。
- テストは対象と同階層 or `__tests__` に `*.test.ts`。
