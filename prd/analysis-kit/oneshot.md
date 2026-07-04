# 一発コピペ用（チャット欄に貼り付け + スクショ3枚 + Enter）

ファイル添付が面倒なとき用。指示・記法・正解例（few-shot）を1メッセージに畳んだプロンプト。
リザルト系スクショ3枚（結果画面 / UPGRADE HISTORY / REWARD LEDGER）と一緒にチャットへ貼って送信する。

## 本文の置き場所（単一の真実）

プロンプト本文は **web のインポート画面の「LLM プロンプトをコピー」ボタン**から配布するため、
[`packages/web/src/assets/oneshot-prompt.txt`](../../packages/web/src/assets/oneshot-prompt.txt) に置いてある。
ここに本文を重複させると必ず乖離するので、**編集は上記 txt のみ**（この文書はポインタ）。

> なぜ web 側か: docker compose watch の sync 対象が `packages/web` / `packages/shared` のみで、
> `prd/` 配下ではプロンプト調整のホットリロードが効かないため（compose.yaml §web.develop.watch）。

契約（`shared` スキーマ / フラット変換規約）との乖離は server のテストで検知する:
本文中の EXAMPLE を ingestion 検証に通し、契約変更で fail させる
（[`packages/server/src/lib/__tests__/oneshot-prompt.test.ts`](../../packages/server/src/lib/__tests__/oneshot-prompt.test.ts)）。

## 内容の要点（本文の設計意図）

- ルール7項（綴りそのまま / 並び順・重複維持 / 灰色斜体=リロール / points は表示値 /
  Σpoints=apocalypse_bonus 自己チェック / 不明値は null / 出力は YAML コードブロック1つ）。
- EXAMPLE は sample-01 相当（points 合計 1208 = apocalypse_bonus で自己整合、リロール行の書き方を実演）。
