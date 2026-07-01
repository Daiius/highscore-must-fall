# ルール: コミット

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
