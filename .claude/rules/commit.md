# ルール: コミット / PR

## コミット

- メッセージは簡潔に、何を・なぜ。1コミット1論点を心がける。
- amend する前に `git log --oneline @{u}..HEAD` で未 push を確認する。push 済みなら新コミットで修正する。
- コミット/プッシュはユーザーから依頼された時のみ行う。デフォルトブランチ上なら先にブランチを切る。
- 秘密情報（`.env*`・OAuth クレデンシャル・本番/開発の具体情報）は絶対にコミットしない。`.gitignore` を信頼しきらず差分を確認する。
- Git hooks は **git 2.55+ の config ベース hooks**（`.githooks.gitconfig` + `.githooks/`）。`pnpm install`(prepare→`.githooks/install.sh`) で `include.path` を冪等設定して有効化する。lefthook/husky は使わない。
  - pre-commit: staged ファイルに Biome（`.githooks/pre-commit`、依存未導入時はスキップ）。pre-push: `pnpm typecheck`。
  - **git >= 2.55 が前提**（未満ではフックはスキップされる）。
  - **`command` に直接コマンドを書かない**。config ベースの pre-push 等には git が引数（`<remote-name> <remote-url>` 等）を追記実行するため、素のコマンドを直書きすると意図せぬ引数が渡り原因不明のエラーになる。必ず `.githooks/` 配下のラッパースクリプト経由にし、引数を無視させる。
  - フックスクリプトは失敗時に **`[pre-commit]`/`[pre-push]` 等のプレフィックス付きで何が失敗したかを標準エラーに明示**する（原因特定に時間を溶かさないため）。
- CI でも `pnpm check` / `pnpm typecheck` / `pnpm test` を通すこと。

## PR

- **PR 本文は [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md) の構造に従う**（正典）。セクション: `概要` / `実装` / `設計上の判断`(任意) / `検証`。
- 作成は **`/create-draft-pr` スキル**を使う（現在ブランチの diff・コミットからテンプレを埋めて `gh pr create --draft`）。既定でドラフト作成し、準備でき次第 `gh pr ready` で上げる。`gh` の `--body` はテンプレを自動適用しないため、スキルがテンプレを読んで本文を組み立てる。
- タイトルは Conventional Commits 形式（例 `feat(shared): ...`）。base は既定ブランチ（通常 `main`）。
- **マージは merge commit**（`gh pr merge --merge`）。**squash はしない**
  （ブランチのコミットは 1コミット1論点で積んでいるため、履歴をそのまま残す）。
- **`検証` セクションは実行済みのゲートだけにチェックを入れる**（未実行を「済」と偽らない）。最低限 typecheck / biome check / test。
- **レビュー bot**: PR に `@highscore-must-fall-reviewer review` とコメントすると自動レビューが走る（通常10分以内に応答）。マージ前に必ず1回は実行し、指摘に対応 → 再度 `review` コメント、のループで指摘が無くなってからマージする。
  - **bot 側の設定は [`.github/review-bot.json`](../../.github/review-bot.json)**（bot に仕様正典として読ませる範囲を宣言する）。bot は**既定ブランチの**設定を読むため、PR head で書き換えてもその PR のレビューには効かない。
  - **レビュー中に PR の内容が変わると bot は中断する**（無応答に見える）。`review` コメントを投げる前に push を済ませ、**応答が返るまで push しない**。追加の修正は応答を受け取ってから積み、再度 `review` を投げ直す。
  - **応答待ちは 20 分でタイムアウト**し、ポーリングを打ち切る。待ち続けない。
  - **bot が不調（無応答・エラー）のままマージしない**。ユーザーからの明示的な指示があるときだけマージしてよい。タイムアウトしたらその旨を報告し、指示を仰ぐ。
  - **bot のスクショ誤読指摘**: review bot はスクショ自動解析 worker と**同じモデル系統＝同じ OCR 誤読を再現する**。カタログ名の綴りを「スクショと違う」と指摘されたら、**bot 自身が誤読している可能性を先に疑う**。
    - **手順**: `catalog-data.ts` の `evidence` を見る。**`evidence` のある名前への指摘は却下してよい**（返信コメントに `prd/samples/<evidence>.png` のパスと、画像のどこ（週・行）かを書く）。evidence の実在はテストが強制しているので、主張は検証可能な既定事実である。**`evidence: null`（仮登録）の名前への指摘は正当な可能性がある**が、bot の読みを鵜呑みにして seed を書き換えず、疑義台帳に記録してスクショで決着させる。
    - 指摘が繰り返されるなら説得を続けず、ユーザー判断で override マージ。→ 正典は [`prd/08-catalog-lifecycle.md`](../../prd/08-catalog-lifecycle.md) §8。
- **マージはユーザーから依頼された時のみ行う**（コミット/プッシュと同じ扱い）。レビューが通ったからといって自動でマージしない。
- Co-Author / PR バイラインは `settings.json` の `attribution` で抑制済み（本文へ署名を書かない）。
