# 01. ゲームドメイン（Utopia Must Fall）

このアプリが記録・分析する対象は **Utopia Must Fall** のプレイ結果である。
データモデル（[03-data-model.md](./03-data-model.md)）と投入仕様（[04-ingestion.md](./04-ingestion.md)）は、
すべてこの章のドメイン事実を地盤とする。実装エージェントはまずここを参照すること。

> 一次情報はプレイ結果画面のスクリーンショット3枚（後述）と、その手起こしサンプル（末尾）。
> 本章は**観測できた事実**に基づく。未確認の点は「未確認」と明記する。

---

## 1. ゲーム概要

- ジャンル: ウェーブ防衛系のローグライト・アーケード。プレイヤーは都市を守りながら、
  ゲーム進行に応じて強化（後述の「アップグレード」）を選択していく。
- 1回のプレイ（以下 **run**）は、一定の**日数（days）を生き延びる**形で進行し、最終的に終了して結果画面に至る。
- **難易度設定・プレイモードは存在しない**。プレイ条件を分ける軸はない（→ 比較は基本的に全 run を同列に扱える）。
- **ゲームバージョン**はプレイ結果画面からは取得できない（記録対象に含めない。詳細は [03](./03-data-model.md)）。

## 2. 時間軸: 日（day）と週（week）

- 進行の基本単位は **日（day）**。結果画面に `DAYS SURVIVED`（生存日数）が出る。
- アップグレードの取得履歴は **週（week）** でグルーピングされる。**1週間 = 7日**。
  - 例: `DAYS SURVIVED = 10` の run では、`WEEK 1`（1〜7日目）と `WEEK 2`（8〜10日目）が存在する。
- **「タイミング」の記録粒度は「週 + 週内の取得順」とする**（日単位は持たない）。
  - 理由: 結果画面のスクショから確実に取れるのが「どの週か」と「週内で何番目か」まで。正確な取得日は取れない。
  - これは分析目的（「序盤=WEEK1 で何を取る傾向か」等）に十分。→ [03](./03-data-model.md) / [06](./06-analysis.md)。

## 3. アップグレード（ゲーム内呼称「contract」）

- プレイヤーは進行中、提示される選択肢から強化を選ぶ。**ゲーム内ではこれを「contract（契約）」と呼ぶ**
  （都市の住人と"契約"を結ぶフレーバー）。
  - ⚠️ この用語はコードのパッケージ名 `contract` と紛らわしいため、**パッケージ名には使わない**
    （データ契約は `shared` パッケージに置く。→ [02](./02-architecture.md)）。
- 取得したアップグレードは結果画面の `UPGRADE HISTORY` に、**週ごと・取得順**で一覧表示される。
- **重複取得がある**: 同じアップグレードを複数回取れる（例: `DEPLOY LASER WATCHTOWER` が同一週に2連続）。
  → 名前の集合ではなく、**順序付きの列**として保持する必要がある。
- 表示上、項目ごとに**文字色が異なる**（黄/紫/水/青/赤…）。これはレアリティやカテゴリを示唆する可能性があるが、
  **現時点では意味を確定していない（未確認）**。MVP では記録しない。将来カタログ属性化を検討（→ [06](./06-analysis.md) Phase2）。

### 3.1 リロール（reroll）

- プレイヤーは「提示された選択肢を**引き直す（リロール）**」ことを選べる。
- リロールすると、`UPGRADE HISTORY` の順序列の中に、**灰色斜体のフレーバーテキスト**が
  （実際に取得した色付きアップグレードと並列に）差し込まれる。
- 確定した事実:
  - **灰色1行 = リロール1回**。
  - 灰色のフレーバーテキストは**ほぼランダムな飾り**で、ゲームシステム上の意味は薄い。
  - リロール・アップグレード以外の**第3の種別は存在しない**。
  - 分析上は**「いつ・何回リロールしたか」だけで十分**（フレーバー内容の集計は不要）。
- モデリング方針（→ [03](./03-data-model.md)）:
  - 履歴の各エントリは `entry_type ∈ {upgrade, reroll}`。
  - リロールも順序列の位置を保持する（「WEEK2 の3手目でリロール」を再現可能に）。
  - 一方「位置 N のアップグレード」を見たい分析向けに、**アップグレードのみの通し番号**も導出する。
  - リロールはカタログに登録しない。フレーバーテキストは任意で verbatim 保存するが集計対象外。

## 4. 結果指標（result）

結果画面トップに表示される run のサマリ。観測できた指標:

| 指標 | 説明 |
|---|---|
| `days_survived` | 生存日数（例 10） |
| `final_score` | 最終スコア（例 143161）。分析の主対象 |
| `aliens_defeated` | 撃破数（例 1336） |
| `nukes_launched` | 核発射回数（例 3） |
| `apocalypse_bonus` | アポカリプスボーナス（例 1208）。後述の通り reward の合計に等しい |

> ⚠️ サンプルは**全指標を網羅していない可能性がある**。新指標が後から増える前提で、
> 正規化済みコア指標 + `raw_payload`(JSON) のハイブリッド保存とする（→ [03](./03-data-model.md)）。

## 5. リワード台帳（reward ledger）

- 結果画面の `REWARD LEDGER` に、run 中に発生した**実績（reward）**が一覧される。
- 各行は **`name`（実績名） / `count`（発生回数, 例 `21×`） / `points`（合計点）** の3列。
- 末尾に合計（☆）が表示され、脚注に **`TOTAL EXCLUDES REWARD MULTIPLIERS`**（この合計は乗数を除く）とある。

### 5.1 整合関係（重要な検証ルール）

- 観測事実: **`apocalypse_bonus` == Σ(reward_ledger[*].points)**。
  - 実測検証: サンプルの reward 合計
    `250+168+140+120+90+90+70+65+55+50+40+40+30 = 1208` = `apocalypse_bonus`(1208)。
- この自明な関係を**投入時の整合チェック**に使う（不一致は確定前 warning → 人間が修正）。
  → 全投入ルート共通の品質ゲートとして `shared` に実装（→ [04](./04-ingestion.md)）。
- なお `final_score` は `apocalypse_bonus` とは別系統（乗数等を含む総合スコア）。両者をイコールにはしない。

## 6. データ取得元（スクリーンショット）

1 run の情報は、結果画面から到達できる**3つの画面**にまたがる:

1. **結果画面**: `DAYS SURVIVED` / `FINAL SCORE` / `ALIENS DEFEATED` / `NUKES LAUNCHED` / `APOCALYPSE BONUS`、
   および `UPGRADE HISTORY` `REWARD LEDGER` へのリンク。
2. **UPGRADE HISTORY**: 週ごとの取得履歴（アップグレード＋リロール）。
3. **REWARD LEDGER**: 実績の `name / count / points` 一覧と合計。

- **MVP では各画面1枚ずつ（最大3枚）** のスクショを想定する。
- スクショの役割:
  - **MVP**: 証跡（後から人間が読み取りミスを検証するために再閲覧する）。解析自体はアプリ外（ユーザー自前 LLM）で行う。
  - **Phase3**: 同じ画像をサーバ側 LLM の**処理入力**として使う（→ [04](./04-ingestion.md) / [07](./07-roadmap.md)）。
- 手作業での読み取りは誤りやすい（例: 手起こしサンプルで `apocalypse_bonus` を 1208→1200 と誤記）。
  → **確定前のレビュー＋整合チェックが必須**である根拠。

## 7. 初期カタログ（master）

- アップグレード名・リワード名は表記ゆれ・OCR 誤りで揺れるため、正規化して**カタログ（master）**に名寄せする。
  カタログは事前に全列挙せず、**未知名を自動登録（unverified）→ 後で人手で verify/統合**して育てる（→ [03](./03-data-model.md)）。
- **初期 seed はサンプルに登場した名称のみ**投入する。

### 7.1 アップグレード（16種）

> `DEPLOY LASER WATCHTOWER` はサンプル内で2回出現するが、カタログ上は1エントリ（重複は run 側の履歴で表現）。
> リロール由来の灰色テキスト（`DIGITIZE CONSCIOUSNESS` / `WELCOMING CEREMONY`）は**アップグレードではない**ため含めない。

WEEK 1 由来:
`NUCLEAR WEAPONS LAB` / `RATIONED WARHEADS` / `INCREASE PRODUCTION` / `ARC FLAIL` /
`INCREASE FIRE RATE` / `REGENERATIVE SHIELD` / `BLACKOUT PROTOCOL` / `INSTITUTE OF AUTOMATION` /
`DEPLOY LASER WATCHTOWER` / `PLASMA PHYSICS LAB` / `OPTIMIZED OPERATIONS`

WEEK 2 由来:
`ADVANCED MATERIALS LAB` / `EXTENDED FLAIL` / `CONTEXT SWITCH` / `OFFENSIVE INNOVATION CENTER` /
`COBALT COIL GUN`

（計 16 種）

### 7.2 リワード（13種）

`BOHEMIAN` / `OBSESSIVE` / `CHEF'S KISS` / `CONSERVATION` / `NO ESCAPE` / `LASER DISCO` /
`DISCIPLINE` / `ANNIHILATION` / `COMPLETIST` / `MINT CONDITION` / `GONNAHAVEMESOMEFUN` /
`HARD CHEESE` / `CLOSE SHAVE`

（計 13 種）

## 8. サンプルデータ（一次情報）

> このアプリが扱う1 run の構造を最もよく表す実データ。スクショ手起こし由来（`apocalypse_bonus` は正値 1208 に修正済み）。

```yaml
game: UTOPIA MUST FALL
result:
  days_survived: 10
  final_score: 143161
  aliens_defeated: 1336
  nukes_launched: 3
  apocalypse_bonus: 1208      # = Σ(reward_ledger.points)
upgrade_history:               # 週グループ + 週内取得順。重複あり / リロール(灰色)を含む
  week_1:
    - NUCLEAR WEAPONS LAB
    - RATIONED WARHEADS
    - INCREASE PRODUCTION
    - ARC FLAIL
    - INCREASE FIRE RATE
    - REGENERATIVE SHIELD
    - BLACKOUT PROTOCOL
    - INSTITUTE OF AUTOMATION
    - DEPLOY LASER WATCHTOWER
    - DEPLOY LASER WATCHTOWER
    - PLASMA PHYSICS LAB
    - OPTIMIZED OPERATIONS
  week_2:
    - ADVANCED MATERIALS LAB
    - DIGITIZE CONSCIOUSNESS    # リロール（灰色斜体・フレーバー）= upgrade ではない
    - EXTENDED FLAIL
    - CONTEXT SWITCH
    - WELCOMING CEREMONY        # リロール（灰色斜体・フレーバー）= upgrade ではない
    - OFFENSIVE INNOVATION CENTER
    - COBALT COIL GUN
reward_ledger:                 # name / count(発生回数) / points(合計)
  - { name: BOHEMIAN,           count: 1,  points: 250 }
  - { name: OBSESSIVE,          count: 21, points: 168 }
  - { name: CHEF'S KISS,        count: 7,  points: 140 }
  - { name: CONSERVATION,       count: 3,  points: 120 }
  - { name: NO ESCAPE,          count: 3,  points: 90 }
  - { name: LASER DISCO,        count: 3,  points: 90 }
  - { name: DISCIPLINE,         count: 7,  points: 70 }
  - { name: ANNIHILATION,       count: 13, points: 65 }
  - { name: COMPLETIST,         count: 11, points: 55 }
  - { name: MINT CONDITION,     count: 2,  points: 50 }
  - { name: GONNAHAVEMESOMEFUN, count: 2,  points: 40 }
  - { name: HARD CHEESE,        count: 4,  points: 40 }
  - { name: CLOSE SHAVE,        count: 1,  points: 30 }
```

> ⚠️ 上記の YAML は**人間可読なサンプル**であり、システムの正規スキーマそのものではない
> （正規スキーマでは `upgrade_history` の各エントリに `entry_type` を持たせる等の構造化を行う。→ [03](./03-data-model.md)）。

## 9. 未確認・将来の論点

- アップグレードの文字色が示す意味（レアリティ/カテゴリ）。
- アップグレードのカテゴリ分類（建物/研究所/兵器/修飾など）— カタログのリッチ属性として Phase2。
- 結果指標 / カタログの網羅性（サンプル外の項目）。
- **配置・設定を伴うアップグレードの追加情報（検討事項）**: `DEPLOY LASER WATCHTOWER` や
  `DRONE FACTORY`（要確認）等、一部の contract は取得時に**どの場所に展開するか / 設定をどうするか**の
  プレイヤー選択を伴う。この選択は結果画面の `UPGRADE HISTORY`（名前のみ）からは**取得できない**。
  → **ユーザーが後から手動で調整できる自由入力欄**（`upgrade_entry` 単位の任意メモ/設定）を設ける方向で検討。
  MVP では未取得（名前のみ記録）。将来のデータモデル拡張・レビュー UI で対応（→ [03](./03-data-model.md) / [04](./04-ingestion.md)）。
  自動抽出できない人手情報なので、[03](./03-data-model.md) §3.3 の `upgrade_entry` に nullable な注記カラムを足す想定。
- **1 section が1画面に収まらない可能性（検討事項）**: `UPGRADE HISTORY` / `REWARD LEDGER` は項目数が多いと
  **1画面（スクショ1枚）に収まらずスクロールが要る**恐れがある（長期 run ほど顕著。まだプレイ検証できておらず未確認）。
  影響: (a) [04](./04-ingestion.md) §7 の「**section あたり1枚・最大3枚**」前提が崩れうる →
  1 section 複数枚の受理・結合を検討（[03](./03-data-model.md) §3.7 のスキーマは複数枚に耐える設計済み）。
  (b) 分析キット（[analysis-kit/](./analysis-kit/)）の指示に「1画面に収まらない場合は分割スクショ全てを渡す／
  重複行に注意」を追記する必要。→ プレイスキル獲得後に実挙動を確認して確定。
