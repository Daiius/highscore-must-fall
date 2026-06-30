# 01. ゲームドメイン（Utopia Must Fall）

> **状態: スケルトン**。本文は執筆予定。地盤となるドメイン事実をここに集約する。

## 章立て（予定）

- ゲーム概要（ウェーブ防衛系ローグライト・アーケード）
- 時間軸: **日（days）** と **週（week）** の関係。`days_survived` と週グルーピング。
- **アップグレード = ゲーム内では「contract」**（住人と契約を結ぶフレーバー）。※パッケージ名に `contract` を使わない理由。
- **取得履歴**: 週グループ + 週内取得順。重複あり（例: DEPLOY LASER WATCHTOWER ×2）。
- **リロール**: 「選択候補のリロール」を選ぶと、灰色斜体のフレーバーテキストが履歴に並ぶ。
  - 灰色1行 = リロール1回。フレーバーはランダム飾り。分析は「いつ・何回」のみ。
- **結果指標**: `days_survived` / `final_score` / `aliens_defeated` / `nukes_launched` / `apocalypse_bonus`。
- **reward ledger**: `name` / `count`(発生回数) / `points`(合計)。
- **整合関係**: `apocalypse_bonus == Σ(reward.points)`（脚注 "TOTAL EXCLUDES REWARD MULTIPLIERS"）。
- 取得元: 3画面のスクショ（結果 / UPGRADE HISTORY / REWARD LEDGER）。MVP は各画面1枚。
- メタ情報の不在: **難易度なし・モードなし・バージョンはスクショから取得不能**。
- **初期カタログ**（サンプル由来のみ）:
  - upgrade 16種、reward 13種。リロール名（DIGITIZE CONSCIOUSNESS / WELCOMING CEREMONY）は upgrade に含めない。

## サンプルデータ

> 一次情報。`_grilling/decisions.md` のサンプル節を正とする（ここに転記予定）。
