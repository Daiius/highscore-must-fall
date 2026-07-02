# 分析キット — スクショ → 記録 YAML 変換プロンプト

Utopia Must Fall のリザルト画面スクショから、投入用の YAML を**ブレなく**起こすためのキット。
汎用チャット LLM（Claude / ChatGPT 等）に、この 3 ファイルとスクショを渡して使う。

- [`template.yaml`](./template.yaml) — 埋めるべき空テンプレ（記法の注意を `#` コメントで内包）
- [`example.yaml`](./example.yaml) — 埋まった**正解例**（few-shot アンカー。リロールの書き方も実演）
- [`example-02.yaml`](./example-02.yaml) / [`example-03.yaml`](./example-03.yaml) — 追加の実ラン正解例
  （スクショは [`../samples/`](../samples/) の `*-02` / `*-03`。02 はリロール1件を含む・03 は 5 週規模で全て通常アップグレード。いずれも `points` 合計 = `apocalypse_bonus` で自己整合）
- [`oneshot.md`](./oneshot.md) — **一発コピペ用**（指示＋記法＋正解例を1メッセージに畳んだ版。ファイル添付が面倒なとき）
- 本ファイル — 最小指示プロンプト（ファイル添付運用の説明）

投入・検証フローでの位置づけは [`04-ingestion.md`](../04-ingestion.md)。出力 YAML は server の
ingestion アダプタが正規スキーマ（[`shared`](../../packages/shared)）へ 1:1 変換する
（週内の連番 = `order_in_week` を振るだけ）。

## 使い方

`template.yaml` と `example.yaml`、そしてリザルト系スクショ 3 枚
（結果画面 / UPGRADE HISTORY / REWARD LEDGER）を LLM に添付し、以下を貼る。

```text
添付の template.yaml を、3 枚のスクショ（結果 / UPGRADE HISTORY / REWARD LEDGER）を読んで埋めて。
記法は example.yaml に完全に従う。テンプレ内の # コメントの注意を必ず守ること。
最後に reward_ledger の points 合計が apocalypse_bonus と一致するか確認してから、yaml だけをコードブロック 1 つで出力して。
```

## ブレを消す設計（なぜ効くか）

1. **正解例を 1 つ添える（few-shot）** — 散文の指示より、埋まった実例のコピーが最も安定する。
   `example.yaml` は sample-01（`points` 合計 = `apocalypse_bonus` = 1208 で自己整合）で、
   **リロール行の書き方まで実演**している。
2. **注意はテンプレの `#` コメントに内包** — ルールが値の隣にあるので守られやすく、指示本体は 3 行で済む。
3. **自己チェックを 1 行** — `points` 合計 = ☆合計 の突合を出力前にさせ、数値誤読・掛け算ミスを自己修正させる
   （= `shared` の整合チェック `Σpoints == apocalypse_bonus` を投入前に前倒し）。

## ゲーム固有の落とし穴（テンプレ／例で対策済み）

- **リロールは灰色斜体**。色情報は平文で失われるため、`type: reroll` として `flavor` に入れさせる
  （色付き行は `type: upgrade`）。→ 見落とすと通常アップグレードとして誤登録される。
- **`points` は行に表示された数値（その報酬の合計点）**。`count`（`○×`）と掛けない。
- **名前は綴りそのまま**（例: `DIGITIZE` を `DIGITAL` にしない）。同名の連続もそのまま重複させる。

## プログラム経路（参考）

API / 構造化出力で機械的に起こす経路には、`shared` の `json-schema.ts`（`z.toJSONSchema`）が
導出する JSON Schema をそのまま入力スキーマに使える。**人間はテンプレ、機械は JSON Schema** の二本立て。
