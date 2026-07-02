---
name: create-pr
description: このリポジトリの PR テンプレート（.github/PULL_REQUEST_TEMPLATE.md）に沿って、現在ブランチの GitHub PR を作成する。ユーザーが「PR を作って」「プルリク作成」等と依頼したとき、または実装をコミット済みで PR 化する段階で使う。
---

# create-pr — テンプレ準拠の PR を作成する

現在ブランチの変更を、リポジトリ正典の PR テンプレートに沿った本文で GitHub PR にする。
`gh` の `--body` はテンプレを自動適用しないため、**このスキルがテンプレを読んで本文を組み立てる**。

規約の出所: [`.claude/rules/commit.md`](../../rules/commit.md) の `## PR` / テンプレ本体 [`.github/PULL_REQUEST_TEMPLATE.md`](../../../.github/PULL_REQUEST_TEMPLATE.md)。

## 手順

1. **前提チェック**
   - `git rev-parse --abbrev-ref HEAD` で現在ブランチを取得。**既定ブランチ（`main`）上なら中止**し、先にブランチを切るよう促す（PR にはフィーチャーブランチが要る）。
   - `git status --porcelain` を確認。未コミットの変更があれば、含めるか確認してからコミット（コミット規約に従う。依頼が「PR 作成」なら関連変更のコミットまでは依頼の範囲内とみなしてよい）。
   - 既に同ブランチの PR があれば新規作成せず、その旨を伝えて更新（`gh pr edit`）を提案する（`gh pr view --json url,state` で確認）。

2. **変更内容の把握**（本文を埋めるため）
   - `git log --oneline main..HEAD` … コミット列。
   - `git diff --stat main...HEAD` … 変更ファイル俯瞰。
   - 主要ファイルは中身の diff も見て「何を・なぜ」を正確に書く（推測で埋めない）。

3. **品質ゲートを実行**（`検証` セクションのチェックは実行したものだけ入れる）
   - `pnpm typecheck` / `pnpm check`（Biome）/ `pnpm test`（Vitest）。
   - 失敗したら PR を作らず、まず直す（または結果を正直に本文へ書く）。**未実行を「済」と偽らない。**

4. **本文を組み立てる**
   - [`.github/PULL_REQUEST_TEMPLATE.md`](../../../.github/PULL_REQUEST_TEMPLATE.md) を読み、その見出し構造をそのまま使う。
   - `概要`（何を・なぜ／関連する PRD・ルールへリンク）→ `実装`（ファイル/モジュール単位の表）→ `設計上の判断`（特筆点が無ければ削除）→ `検証`（実行したゲートにチェック）。
   - HTML コメントの記入ガイドは最終本文から**削除**する。

5. **push & 作成**
   - 未 push なら `git push -u origin <branch>`（pre-push で typecheck が走る）。
   - `gh pr create --base main --head <branch> --title "<Conventional Commits 形式>" --body "<組み立てた本文>"`。
   - タイトルは主コミットに倣う（例 `feat(shared): ...`）。

6. **報告**: 作成された PR の URL をユーザーに返す。

## 注意

- **Co-Author / PR バイラインは書かない**（`settings.json` の `attribution` で抑制済み。本文へ署名や生成元表記を足さない）。
- 秘密情報（`.env*`・クレデンシャル・本番/開発の具体情報）を本文に含めない。
- base ブランチが `main` でよいか不明な場合のみ確認する。それ以外は既定で `main` に向ける。
