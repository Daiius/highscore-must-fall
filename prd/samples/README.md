# サンプル（一次情報）とスクショ収集ガイド

このディレクトリの PNG は**このアプリにおける唯一の一次情報**である。
カタログ名称の `verified` は「ここにある画像と突合できたこと」を意味する。
二次情報（Steam ガイド）は系統分類の出典にはなるが、**`verified` の根拠にはならない**。

- 名称リストの正典: [`packages/database/src/catalog-data.ts`](../../packages/database/src/catalog-data.ts)
- 系統分類: [`packages/shared/src/series.ts`](../../packages/shared/src/series.ts)
- 疑義・未検証の台帳: `.claude-personal/catalog-suspects.md`（gitignore）

## 1. ファイル命名

`<section>[-<連番>].png`。連番なしが sample-01、以降 `-02` `-03` … と増やす。

| section | 内容 |
|---|---|
| `main-result` | 結果画面（`final_score` / `days_survived` / `apocalypse_bonus` 等） |
| `contracts` | UPGRADE HISTORY（週グループ・取得順・リロールの灰色斜体を含む） |
| `rewards` | REWARD LEDGER（`name` / `count` / `points`） |

**3 section が揃っている必要はない。** カタログの `verified` 化だけが目的なら `contracts` か
`rewards` の1枚で足りる（実際 sample-04 は `contracts-04.png` のみ）。
run として投入・分析するなら3枚とも要る。

## 2. 撮影規約

**1 section = 1枚。スクロールさせない。** `prd/04-ingestion.md` §7 の MVP 制約であり、
長い run で1画面に収まらない場合、現状は投入できない。

**2列レイアウトの読み順は「左列を上から下まで全部 → 右列」。** 週の見出しが左列の末尾に来て
中身が右列の先頭から始まることがある（`contracts-04.png` の WEEK 3 がこの形）。
読み順を間違えると週がずれる。実運用で W3 の列またぎ誤配を検知した実績がある。

**リロール（灰色斜体）を upgrade と混同しない。** `DIGITIZE CONSCIOUSNESS` / `WELCOMING CEREMONY` /
`LIVE UNDERGROUND` 等。カタログには登録しない（`rules/database.md`）。

**紛らわしい綴りは拡大して確認する。** 実例として `DOUBLE-BARRELLED DRONES`（L が2つ）が正しく、
`DOUBLE-BARRELED`（L が1つ）は誤読。`GONNAHAVEMESOMEFUN` は `ME` が入る。
`LINE'EM UP LLOYD` はアポストロフィ前の空白の有無が未確定。

## 3. 現在の充足状況

| sample | 画像 | 由来 |
|---|---|---|
| 01 | `main-result` / `contracts` / `rewards` | upgrade 16種・reward 13種 |
| 02 | `-02` 3枚 | coil 経路の run |
| 03 | `-03` 3枚 | volley 経路の run |
| 04 | `contracts-04` のみ | **blunderbuss 経路の run**。upgrade 8種を verified 化 |

## 4. 残っている空白と、埋めるための run 条件

`verified: false` の名前は、**その名前が出る run を回して該当 section を撮る**ことで昇格できる。
経路ごとにまとめて回収できるので、狙う順に並べる。

### 主砲: basilisk 経路を1本（最大の回収効率）

`TELEGRAPH BASILISK` / `INCREASE BUNDLING RATE` / `SPLINTERING POLES` / `HARDENED SPLINTERS` の
4件が一度に verified 化できる。加えて `OVERWEIGHT BUNDLES`（ガイドにあるがカタログ未登録＝未観測）と
`EXTENDED BARREL`（分岐前の共通強化）も同時に狙える。

### 主砲: blunderbuss 経路（優先度は低い）

`contracts-04.png` のチェーンは `GARBAGE BLUNDERBUSS` → `QUAD BLUNDERBUSS` → `PENT BLUNDERBUSS` で、
volley の4段（`VOLLEY` → `TRIPLE` → `QUAD` → `PENT`）に対して1段抜けている。
**`TRIPLE BLUNDERBUSS` は存在しないと推定する**（seed にもカタログにも入れない）。根拠は2つ:

1. アップグレードは前段を前提に段階的に増える。`QUAD` が初段である以上、`TRIPLE` が入る余地が無い。
2. 散弾銃である基本形 `GARBAGE BLUNDERBUSS` が既に3発相当と解せば、次段が `QUAD` になるのは自然。

いずれも推論であり、**UPGRADE HISTORY は取得履歴であって存在する contract の一覧ではない**ため、
1 run の不在は不在の証明にならない。決着させるなら分岐後の選択肢画面を撮る。

### シールド系を厚く取る run

`PULSE REFLEX` / `SHIELD BLAST` / `EXPANDED SHIELD NETWORK`(OU) の3件。
`REFINED BLAST CHAMBERS` の**系統**もここで判明する可能性がある（現在は意図的に未分類）。

### そのほか

- `ROBOTICS SPECIALIST` — ガイドの系統ツリーに無い。実測 run で2回出現。実在するなら系統を確定したい。
- `URANIUM STRIP MINING` / `OVER-FUELLED BOOSTERS`（核）、`Q-DISRUPTOR TOWER` / `THIN DRONE FACTORY`（自動防衛）
  — ガイドにあるがカタログ未登録＝未観測。
- OU は抽選で提示されるため**狙って取れない**。出たら撮る。ガイド掲載20種のうち
  カタログに載ったのは7種。
- reward: `FIRECRACKER` / `LINE'EM UP LLOYD`。後者は綴りの確認が主目的なので拡大が要る。

> `verified` の昇格は現在 `catalog-data.ts` を書き換えて再 seed する以外に手段が無い。
> カタログ管理 UI（unverified 一覧・verify・マージ）が入れば、この README の運用は変わる。
