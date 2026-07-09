# ルール: React（`packages/web`）

## メモ化は React Compiler に任せる

- **`useMemo` / `useCallback` / `memo()` を手で書かない。** メモ化は **React Compiler** が行う。
  設定は `packages/web/vite.config.ts`（`babel-plugin-react-compiler`）。
- 計算はコンポーネント本体に素直に書く。重い計算（例: 全行 × カタログ全件の類似候補検出）でも、
  コンパイラが依存を推論してキャッシュする。
- `react/compiler-runtime` は React 19 本体に含まれるため、追加の runtime パッケージは不要。

### `panicThreshold: 'all_errors'`

コンパイルできない箇所は**ビルドを失敗させる**設定にしている。理由:

コンパイラが黙ってバイパスすると、そのコンポーネントの関数値がレンダーごとに新しくなる。
`useEffect(..., [fetchRun])` のように**「メモ化されている前提」の依存配列**がそのまま再取得ループになり、
型検査にもテストにも引っかからない実行時バグになる。静かに諦めさせず、ビルド時に気づく。

## コンポーネントに `try` / `catch` / `finally` / `throw` を書かない

React Compiler 1.0 はコンポーネント・フックの中の以下を**まだ実装していない**（エラーは `Todo:` で始まる）。

| 構文 | 状況 |
|---|---|
| `try/catch` 内の `??` `?.` 三項 `&&`（value block） | 1.0 は NG（experimental では修正済み） |
| `try` 内の `throw` | NG |
| `try/finally` | NG |

→ 既知の未実装: [facebook/react#35570](https://github.com/facebook/react/issues/35570)

**回避策**: I/O とエラー処理を **`src/lib/api-result.ts`** に閉じ込め、コンポーネントは
Rust の `Result<T, E>` 相当（`{ ok: true; value } | { ok: false; error }`）を分岐するだけにする。
`try/catch` を書いてよいのはこのモジュールだけ。

```ts
const result = await callApi<RunDetailData>(() => client.api.runs[':id'].$get({ param: { id } }))
if (result.ok) setRun(result.value)
else if (result.error.kind === 'unauthorized') clearSession()
else setNotFound(true)
```

- 通信でない throw（clipboard 書き込み・OAuth 開始など）は `attempt()` で真偽値に畳む。
- 失敗の種類は `unauthorized` / `status`（body 付き）/ `network` の 3 つ。HTTP の詳細を UI に漏らさない。
- **エラーを握りつぶすには `else` を書く必要がある**のが利点。`catch {}` の取りこぼしが型で見える。

### コンパイラを妨げないその他の書き方

- **レンダー中に ref を書き換えない**（`useRef` のカウンタを render 中に `++` する等）。
  行の React key が要るなら、既存行はサーバの id を、追加行は `crypto.randomUUID()` を使う。
- props・state・コンテキストの値を変更しない（読み取り専用として扱う）。

## そのほか

- コンポーネントファイルは PascalCase（[typescript.md](./typescript.md) の例外）。
- Tailwind のクラス整列は Biome の `useSortedClasses`（[typescript.md](./typescript.md) 参照）。
