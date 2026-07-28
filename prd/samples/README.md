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
| `contracts-tree` | SIGN CONTRACTS 画面（技術ツリー）のノード説明。**未取得の名前も読める**（§4） |
| `rewards` | REWARD LEDGER（`name` / `count` / `points`） |

**この拡張子を除いたファイル名が `evidence` 識別子**になる（例 `contracts-04`）。
`catalog-data.ts` の各エントリはこの値で「どの画像と突合したか」を示し、テストが実在を強制する
（[`prd/08-catalog-lifecycle.md`](../08-catalog-lifecycle.md) §3）。**ここにある画像を消す/改名するとテストが落ちる。**

**3 section が揃っている必要はない。** カタログの `verified` 化だけが目的なら `contracts-tree` か
`rewards` の1枚で足りる（実際 sample-04 は `contracts-04.png` のみ）。
run として投入・分析するなら `main-result` / `contracts` / `rewards` の3枚が要る。

`contracts-tree` は**カタログ verify 専用**で、run 投入には使わない（取得履歴ではなくツリーの閲覧なので）。

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

`evidence` として使われている画像と、そこを根拠にしている名前の数（`catalog-data.ts` が正典）。

| sample | 画像 | 由来 | evidence 元になっている名前 |
|---|---|---|---|
| 01 | `main-result` / `contracts` / `rewards` | 最初の run | upgrade 16 / reward 13 |
| 02 | `-02` 3枚 | coil 経路の run | upgrade 13 / reward 12 |
| 03 | `-03` 3枚 | volley 経路の run | upgrade 13 / reward 3 |
| 04 | `contracts-04` のみ | **blunderbuss 経路の run** | upgrade 9 |
| tree-01 | `contracts-tree-01`（**証拠シート**） | basilisk 経路の run のツリー閲覧 | upgrade 10 |
| tree-02 | `contracts-tree-02`（**証拠シート**） | **coil 枝**のツリー閲覧（7ノードを順にホバー） | upgrade 3 |

同じ名前が複数の画像に写ることはあるが、**`evidence` に書くのは1枚だけ**（根拠は1枚で足りる）。
`contracts-tree-02` には既に verified だった4種も写っているが、`evidence` は初出の画像のまま置いてある。

容量は 01〜04 の10枚で 7.7MB、`contracts-tree-01` は10種分で 132KB、`contracts-tree-02` は7帯で 137KB。
差は §5 の証拠シート方式による。

## 4. 残っている空白と、埋め方

### まず SIGN CONTRACTS 画面のツリーを撮る（2026-07-26 以降の既定手順）

契約選択画面の右半分は**技術ツリー全体のブラウザ**で、ノードにカーソルを合わせると画面下部に
名称・説明・前提条件・効果が出る。**取得していないノード・ロック中のノードも読める。**

これが効くのは、従来の「その名前が出る run を回して UPGRADE HISTORY を撮る」が重すぎたからである。
1件のために 1 run 回すのは現実的でなく、`ROBOTICS SPECIALIST` のように**そもそも出方が分からない
名前は永久に埋まらない**。ツリーなら 1 run の途中で、到達していない枝まで舐めて回収できる。

実際 `contracts-tree-01` は 1 run 分のホバーだけで、仮登録5種の昇格（`TELEGRAPH BASILISK` /
`INCREASE BUNDLING RATE` / `SPLINTERING POLES` / `HARDENED SPLINTERS` / `EXTENDED BARREL`）と
新規5種（`OVERWEIGHT BUNDLES` / `HURRIED BUNDLING` / `INCENDIARY COATING` /
`OVER-FUELLED BOOSTERS` / `REFUGEE ASYLUM SCHEME`）を同時に埋めた。

**枝を1本ずつ舐めると系統ごと決着する。** `contracts-tree-02` は coil 枝を基本形から順にホバーして
7ノードを1枚に収め、新規3種（`ADVANCED RICOCHET` / `FULL GRAPHENE COATING` /
`SUPERCONDUCTING MAG RAIL`）を埋めた。この方式なら**枝の網羅性そのものが証拠に残る**ので、
残る volley / blunderbuss / basilisk も同じ手順で片づけられる。

**撮り方**: ツリーの未取得ノードを順にホバーし、下部の帯が変わるたびに1枚撮る。1枚 = 1名称でよい
（帯だけ切り出すので、画面の他の部分は捨てる）。左パネル（その週の提示）も名称の根拠になる。

**ツリーで埋まらないもの**: reward（REWARD LEDGER にしか出ない）と、run 投入用の3枚。

### 主砲: blunderbuss 経路（優先度は低い）

`contracts-04.png` のチェーンは `GARBAGE BLUNDERBUSS` → `QUAD BLUNDERBUSS` → `PENT BLUNDERBUSS` で、
volley の4段（`VOLLEY` → `TRIPLE` → `QUAD` → `PENT`）に対して1段抜けている。
**`TRIPLE BLUNDERBUSS` は存在しないと推定する**（seed にもカタログにも入れない）。根拠は2つ:

1. アップグレードは前段を前提に段階的に増える。`QUAD` が初段である以上、`TRIPLE` が入る余地が無い。
2. 散弾銃である基本形 `GARBAGE BLUNDERBUSS` が既に3発相当と解せば、次段が `QUAD` になるのは自然。

いずれも推論であり、**UPGRADE HISTORY は取得履歴であって存在する contract の一覧ではない**ため、
1 run の不在は不在の証明にならない。**ツリーなら決着する**——blunderbuss 枝のノードを順に見て
`TRIPLE BLUNDERBUSS` が無ければ、ようやく不在の根拠になる。

### シールド系

`PULSE REFLEX` / `SHIELD BLAST` / `EXPANDED SHIELD NETWORK`(OU) の3件。
`REFINED BLAST CHAMBERS` の**系統**もツリー上の位置から判明する可能性がある（現在は意図的に未分類）。

### そのほか

- `ROBOTICS SPECIALIST` — ガイドの系統ツリーに無い。実測 run で2回出現。**ツリーに実在するかを見れば
  一度に片づく**（無ければ誤読の疑いが濃くなる）。
- `URANIUM STRIP MINING`（核） / `Q-DISRUPTOR TOWER`（自動防衛） — ガイドにあるがカタログ未登録＝未観測。
- **`THIN DRONE FACTORY` は追わない。** 正体は verified な `TWIN DRONE FACTORY` の OCR 誤読
  （`contracts-04.png`）であり、実在しない。収集対象に見えても再登録しないこと
  （[`prd/08-catalog-lifecycle.md`](../08-catalog-lifecycle.md) §7・§8）。
- OU は抽選で提示されるため**狙って取れない**。出たら撮る（左パネルの `LIMITED OPPORTUNITY` 欄）。
  ガイド掲載20種のうちカタログに載ったのは8種。
- reward: `FIRECRACKER` / `LINE'EM UP LLOYD`。後者は綴りの確認が主目的なので拡大が要る。
  reward はツリーに出ないので REWARD LEDGER を撮るしかない。

> **`verified` の昇格は常に `catalog-data.ts` に `evidence` を書いて PR を通す**（意図的にこの経路だけにしてある。
> 根拠がレビューに乗らないフラグは無価値なため）。カタログ管理 UI が入っても verify ボタンは付かない。
> 手続きの正典は [`prd/08-catalog-lifecycle.md`](../08-catalog-lifecycle.md)。

## 5. 証拠シート（フル解像度スクショをコミットしない方式）

フル解像度スクショは1枚 1MB 前後ある。verify のたびにこれを積むとリポジトリが太るので、
**`evidence` に置くのは「名前が読める帯だけを切り出して連結した1枚」**でよい（`contracts-tree-01.png`）。
規約の正典は [`prd/08-catalog-lifecycle.md`](../08-catalog-lifecycle.md) §3.1。

```bash
# 1. 原本を .claude-personal/samples-raw/ に置く（gitignore。リポジトリには入れない）
# 2. manifest（prd/samples/<sheet>.json）に原本ファイル名・切り出し矩形・写っている名前を書く
node scripts/evidence-sheet.mjs prd/samples/contracts-tree-01.json           # シート生成（sha256 を補う）
node scripts/evidence-sheet.mjs prd/samples/contracts-tree-01.json --verify  # 原本から再現できるか検証
```

`--verify` は**原本が手元にある環境でしか通らない**（原本は git に無い）ので、**CI には入れない**。
綴りに疑義が出たときにローカルで回す検査である。

**この方式が使えない section**: `contracts`（UPGRADE HISTORY）。リロールを**灰色斜体**で区別しており、
グレースケール化すると色の情報が落ちる。帯の切り出しも、画面全体が名前の列なので効果が薄い。

**矩形の当て方**（1330x992 のウィンドウ実測値）:

| 対象 | rect `[x, y, w, h]` | 実測した原本 |
|---|---|---|
| 下部のノード説明帯 | `[55, 788, 1270, 170]` | 1330x992（tree-01） |
| 下部のノード説明帯 | `[55, 773, 1270, 185]` | 1326x992（tree-02） |
| 左パネルの1項目（見出し＋名称） | `[40, 228, 470, 90]` | 1330x992（tree-01） |

解像度が変われば当然ずれる。ずれたら生成物を目で見て詰めること（`node scripts/evidence-sheet.mjs` は
上書き生成なので何度でもやり直せる）。**帯は下端揃えでなく説明の行数で上下する**ので、
名称行が切れないよう上に余裕を取る（tree-02 で 788 だと1行目が欠けた）。
`node scripts/evidence-sheet.mjs` の後は**必ず生成物を目で見る**——切れていてもコマンドは成功する。
