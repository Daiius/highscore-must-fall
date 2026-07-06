# ヒアリング決定事項（grill-me 進行中・作業メモ）

> このファイルは仕様策定のための **作業中メモ**。確定したら正式な PRD ドキュメントへ昇格する。
> 対象アプリ: **Utopia Must Fall** のプレイ結果（スコア／アップグレード取得履歴／リワード）を記録し、
> 「どのアップグレードをどのタイミングで取ったか」「ハイスコアの傾向」を分析するアプリ。

## 確定事項

### 全体方針
- **Q1**: ゲーム仕様は本人ヒアリング起点。サンプル（結果画面スクショの分析結果）を一次情報とする。
- **Q2 投入方式**: **A 半自動**（スクショ → LLM 構造化下書き → 人間レビュー/修正 → 確定保存）を軸に据える。
- **複数投入ルート**（全て同一の正規スキーマに収束）:
  | ルート | 対象 | LLM の場所 | 受け口 |
  |---|---|---|---|
  | 全自動 | 自分/有料（相当先） | サーバ側（こちら負担） | 画像アップロード |
  | LLM連携 | 無料 | ユーザー自前 | MCP / API |
  | ファイル | 無料 | ユーザー自前 | インポート（JSON標準・YAML受理） |
  - 設計思想: **LLM 分析はアダプタとして差し替え可能**にし、下流（保存・分析）は経路非依存で共通化。
  - **正規スキーマ＝システムの中心契約（versioned contract）**。
- **Q3 MVP スコープ**: **A 個人ファースト + 将来のマルチユーザー化を阻害しない分離境界だけ先に引く**。
  - MVP では認証・課金・全自動 LLM は**作らない**（相当先）。
  - 最初から正しく分離する3境界: ① 正規スキーマ(contract) ② ingestion アダプタ層 ③ ストレージ抽象。

### アプリ形態・技術スタック
- **Q4 形態**: **A Web アプリ**（ブラウザ UI + バックエンド API + MCP サーバ）、フルスタック TypeScript。
- 確定スタック:
  - DB: **MySQL**（self-host 環境あり、`mysql:8.4`）
  - API: **Hono**（Hono RPC）
  - ORM: **Drizzle ORM 1.0 RC**（最新 RC を pin。例: 1.0.0-rc.x）
  - Front: **Vite + React 19 + TanStack Router**（router 確定）。初期 self-host、増えたら CF/Vercel 検討。
  - Style: **TailwindCSS**（特定デザインなし）。無難な仮デザイン→後でゲーム風スタイル。
  - **pnpm monorepo + docker compose watch** 開発環境（bind mount 最小）。
- **参考実装**: 同一スタック（Vite+React+TanStack Router+Hono+Drizzle+MySQL+compose watch）の実働リポがほぼ理想形。
  - 構成 `packages/server`(Hono) / `packages/web`(Vite+React+TanStack Router) / `packages/worker`(背景処理)
  - compose watch: `action: sync`/`sync+restart`、`pnpm-lock.yaml` 変更時のみ `rebuild`、DB は named volume のみ。
  - `worker` パッケージ → 将来の「全自動スクショ分析(サーバ側LLM)」のジョブ処理先に自然に載る。
  - 補足参考: 同一スタックの実働リポ（Drizzle 1.0.0-rc + pnpm `catalog:` + `minimumReleaseAge` サプライチェーン対策）。
  - → **後で確認**: pnpm `catalog:` 採用？ `minimumReleaseAge` 採用？

### データモデル
- **Q5 タイミング粒度**: **B 週グループ + 週内取得順インデックス**（日は持たない／順序は保持）。
  - 根拠: スクショから確実に取れるのが週グルーピング＋週内順序。`days_survived` は別途コア指標として保持。
- **Q6 マスタ（カタログ）**: **C マスタテーブルを持つが漸進成長**。
  - 未知名は自動登録 + "unverified" マーク、後でカタログ画面で表記統一・カテゴリ付与・エイリアス統合。
  - 正規化キー（大文字化・トリム等）で名寄せ。
  - **初期マスタ = サンプルにある名称のみシード**（upgrade / reward）。
- **Q7 run レコード保存**: **A ハイブリッド**。
  - 型付きコアカラム（`final_score`,`days_survived`,`aliens_defeated`,`nukes_launched`,`apocalypse_bonus`,`played_at` 等）
  - `raw_payload`(JSON) で正規スキーマ全体を丸ごと保持（未知項目で migration 不要・再処理/監査用）
  - 来歴メタ（`source`,`schema_version`,元スクショ参照,LLMモデル名 等）
  - `upgrade_history` / `reward_ledger` は集計用に**正規化テーブルにも展開**。
- **Q8 パフォーマンス原則**（規模感: 通常1ユーザー内分析、最大 ~1万 run）: **A（1・2・4採用、3はオプション）**。
  1. 全トップレベルテーブルに **`owner_id`** を最初から持たせ複合インデックス先頭に置く。
  2. 重い `raw_payload`(JSON) は**ホット行から分離**（一覧/集計で `SELECT *` しない）。
  3. (オプション) 頻出 JSON 項目は MySQL **生成カラム**で昇格してインデックス。
  4. 集計はまず素のクエリ、事前集計テーブルは作らない（実測で遅ければ導入）。
  - 分析クエリ主役: `upgrade` 行を `upgrade_catalog_id × week` で grouping し `final_score` と相関。
    → `upgrade` 行に `(run_id)`、`(upgrade_catalog_id, week_index)` 系インデックス。

### 契約（contract）
- **Q9 contract 定義・配布**: **A**。
  - monorepo に **`packages/contract`**。**Zod** を単一の真実 → **TS 型** と **JSON Schema** を導出。
  - 相互交換: **JSON 標準**、ファイルインポートは **YAML も受理**（同一 Zod で検証）。
  - **`schema_version`** で版管理、contract パッケージは semver。破壊的変更には変換器。

## サンプルデータ（一次情報・記録対象の構造）
```yaml
game: UTOPIA MUST FALL
result:
  days_survived: 10
  final_score: 143161
  aliens_defeated: 1336
  nukes_launched: 3
  apocalypse_bonus: 1200
upgrade_history:        # 週グループ + 週内取得順（重複あり: DEPLOY LASER WATCHTOWER x2）
  week_1: [NUCLEAR WEAPONS LAB, RATIONED WARHEADS, INCREASE PRODUCTION, ARC FLAIL,
           INCREASE FIRE RATE, REGENERATIVE SHIELD, BLACKOUT PROTOCOL, INSTITUTE OF AUTOMATION,
           DEPLOY LASER WATCHTOWER, DEPLOY LASER WATCHTOWER, PLASMA PHYSICS LAB, OPTIMIZED OPERATIONS]
  week_2: [ADVANCED MATERIALS LAB, DIGITIZE CONSCIOUSNESS, EXTENDED FLAIL, CONTEXT SWITCH,
           WELCOMING CEREMONY, OFFENSIVE INNOVATION CENTER, COBALT COIL GUN]
reward_ledger:          # name / count(発生回数) / points(合計)
  - {name: BOHEMIAN, count: 1, points: 250}
  - {name: OBSESSIVE, count: 21, points: 168}
  - {name: CHEF'S KISS, count: 7, points: 140}
  - {name: CONSERVATION, count: 3, points: 120}
  - {name: NO ESCAPE, count: 3, points: 90}
  - {name: LASER DISCO, count: 3, points: 90}
  - {name: DISCIPLINE, count: 7, points: 70}
  - {name: ANNIHILATION, count: 13, points: 65}
  - {name: COMPLETIST, count: 11, points: 55}
  - {name: MINT CONDITION, count: 2, points: 50}
  - {name: GONNAHAVEMESOMEFUN, count: 2, points: 40}
  - {name: HARD CHEESE, count: 4, points: 40}
  - {name: CLOSE SHAVE, count: 1, points: 30}
```
- 注: サンプルは**全項目を網羅していない**（取得物のみ）。result 指標やカタログは今後増える前提。

### 自前 LLM ルート（contract の配布 / 「分析方法の提供」UX）
- **Q10**: **A**。「分析キット」をユーザーに配る発想。必要4点 = ①JSON Schema ②抽出手順プロンプト ③既知カタログ ④投入チャネル＋検証フィードバック。
  - **段階1（MVP実装）**: ファイル/貼り付けインポート ＋ プロンプトキット配布画面（現行 `schema_version` の JSON Schema＋抽出手順を埋め込み、Zod 再検証でインラインエラー表示）。LLM 非依存で最短に価値、本人運用にも即使える。
  - **段階2（副産物・薄く）**: API（トークン認証、同一スキーマ）。
  - **段階3（本命・次フェーズ実装、契約と接続口だけ先取り）**: MCP サーバ。ツール = `submit_run`（入力スキーマ＝contractのJSON Schema）/ `get_extraction_guide`（最新手順＋schema_version）/ `list_catalog`（正規名カタログ→名寄せ精度向上）。
  - 美点: contract(Zod→JSON Schema) 単一の真実から、段階1のプロンプト埋め込み・段階2のAPI検証・段階3のMCP入力スキーマが全て生成され、画面の「分析方法」もスキーマ更新に自動追従。

### ゲームメタ情報
- **Q11 / Q11b**: **難易度なし・モードなし・game_version はスクショから取得不能** → **C: 条件メタ(difficulty/mode/version)は持たない**。run の時間的文脈は `played_at`(投入時刻)のみ。将来バージョンが要れば played_at 期間から推定。

### スクショ実物からの発見（重要）
- **1 run = 最大3枚のスクショ**: ①結果画面 ②UPGRADE HISTORY ③REWARD LEDGER。ingestion は複数画像を1 runに束ねる前提。
- **`apocalypse_bonus` == Σ(reward_ledger.points)**: 画面1の `☆1208` と reward 合計 1208 が一致（実測検証済み）。脚注 `TOTAL EXCLUDES REWARD MULTIPLIERS`＝乗数除外。final_score とは別系統。
  - → **整合チェックルール**として活用。
- **サンプルYAMLの `apocalypse_bonus:1200` は誤り、正は1208** → レビュー確定ステップ＋整合チェックの必要性の実証。
- **upgrade_history に視覚的区別**: 色付き=取得アップグレード / **灰色斜体=「リロール」した記録（フレーバーテキスト）**。同じ順序列に並列で並ぶ。
  - → 初期カタログ(Q6)で `DIGITIZE CONSCIOUSNESS` `WELCOMING CEREMONY` を upgrade として入れたのは誤り。これらは**リロール記録**。シード見直し要。
  - 色も項目ごとに違う（rarity/category を encode の可能性）→ 将来の catalog 属性候補。

### ingestion 単位 & 整合チェック
- **Q12**: **A**。run を3セクション(result / upgrade_history / reward_ledger)の合成として定義。各セクション個別投入を許容（部分欠けでもドラフト保存可）。確定前レビュー層にクロス整合チェック（例 `apocalypse_bonus == Σreward.points`）を組み込み、不一致は warning 表示→人間が修正。整合チェックは contract 由来ルールとして1か所集約（全ルート共通の品質ゲート）。

### upgrade_history エントリ種別モデル
- **Q13**: **A**（確定事実: 灰色1行=リロール1回 / フレーバーはランダム飾り / 第3種別なし / 分析は「いつ・何回」で十分）。
  - 各エントリに **`entry_type`: `upgrade` | `reroll`**（拡張可能 enum）。
  - 順序列の位置はリロール含め保持。**`upgrade` のみの通し番号**を別途導出（「位置Nのアップグレード」分析用）。
  - `upgrade` → catalog 紐付け。`reroll` → catalog 非紐付け、フレーバーテキストは任意で verbatim 保存、集計は位置・回数のみ。
- **初期シード確定**: upgrade catalog から `DIGITIZE CONSCIOUSNESS`/`WELCOMING CEREMONY`(=リロール) を除外。**upgrade 16種**・**reward 13種**をシード。

### MVP 分析スコープ
- **Q14**: **A**。MVP = 基盤(run 一覧/詳細 CRUD・自己ベスト/ランキング) + **記述的分析**(スコア推移・アップグレード頻度・取得タイミング分布)。本命の**相関分析(アップグレード×タイミング→スコア)は Phase 2**（数十〜数百 run 蓄積後に意味を持つ／記述分析の集計・グラフ部品を再利用）。

### 認証 / identity（★Q3を一部上書き: 認証は MVP に入る）
- **Q15**: **B（強め）**。**最初から OAuth 認証**を用意。**better-auth** + ソーシャルアカウント、初期は **Google**。**最初からパブリック配置**・マルチユーザー前提。
  - `owner_id` = 認証済みユーザー ID。Q8 の owner_id 分離は「将来の備え」でなく**今すぐ効くデータ分離のセキュリティ境界**。
  - 段階1インポートは Web セッション認証で防御。Phase 2 の API/MCP ルートは**ユーザー単位トークン(API キー)** が必要（better-auth で発行）。
  - 公開配置 → HTTPS・シークレット管理・CORS・(将来)レート制限が現実の論点に。
  - 引き続き Phase 2: 課金、全自動 LLM(サーバ側)。
  - 参考: 同一スタックの実働リポが better-auth 採用。

### 認証の具体
- **Q15b**:
  1. **A: ソーシャル OAuth のみ（Google 初手、GitHub/Discord 等を後で追加可能な作り）。メール+パスワードは持たない**（保管/リセット/総当り対策の負担ゼロ）。
  2. **MVP = private データのみ**。個人データは private 既定。**将来は匿名の全体統計（＋検討中のランキング）にオプトインでデータ利用**。**他人個人データのピンポイント閲覧は不可**（当面）。
     - → データモデルに将来「集計利用への同意フラグ（ユーザー単位 nullable）」を足す余地を記憶（MVP 未実装）。
     - → 横断統計/ランキングは自己申告スコアの信頼性問題あり（盛れる）→ 設計は将来。
  3. MVP のランキングは**自分の run 内のみ**。横断ランキングは将来（オプトイン前提）。

### monorepo パッケージ構成
- **Q16**: パッケージ名 = **`shared` / `database` / `server` / `web`**（+ `worker` は将来用スキャフォルドのみ、MVP 非実装）。
  - ★ `contract` は**ゲーム内用語と衝突**（ゲームでアップグレード＝「contract」＝住人と契約を結ぶフレーバー）のため不採用。
  - **`shared`** の中身（責務は「データ契約とその派生物・ルール」で凝集、junk-drawer ではない）:
    1. Zod 正規スキーマ（run レコード）
    2. 導出: TS 型 + JSON Schema（MCP 入力/ドキュメント用）
    3. クロス整合チェックルール（`apocalypse_bonus == Σreward.points` 等）
    4. `schema_version` とバージョン間変換器
    5. 名寄せ正規化ヘルパー（大文字化・トリム等の照合キー生成）
  - `database`: Drizzle スキーマ + マイグレーション + DB クライアント + seed。server/worker/seed が共有。
  - `server`: Hono(RPC) + better-auth + ingestion アダプタ +(将来)MCP。`shared`/`database` 依存。
  - `web`: Vite + React19 + TanStack Router + Tailwind。`shared` 依存。

### 依存管理ポリシー
- **Q17**: **A**。
  - **pnpm `catalog:` 採用**: 共通依存(React/Hono/Drizzle/Zod 等)を `pnpm-workspace.yaml` の `catalog:` に一元化、各 package.json は `"x":"catalog:"` 参照。版ズレ防止。
  - **`minimumReleaseAge` 採用**: 既定 **3日(4320分)**。公開直後の悪意リリース対策。**最新追従したい依存(Drizzle 1.0 RC 等)は明示 pin で例外化**。

### エージェント指示・ルール（複数エージェント併用）
- **Q18**: **A**。
  - **CLAUDE.md**: 最小。`@AGENTS.md` import（or「See AGENTS.md」）のみ。
  - **AGENTS.md**: 正典のリンクハブ（簡潔）。目的(1行+prdリンク)/スタック・パッケージ構成マップ/開発コマンド(`pnpm dev`=compose watch 等)/**「ルール」セクションで `.claude/rules/*.md` を1つずつリンク**。各エージェントが AGENTS.md 経由でルール発見。
  - **`.claude/rules/`**: 内容はツール中立に記述。初期は核数本のみ→実装で育てる。初期候補:
    - `typescript.md`（TS/命名/lint）
    - `schema-and-contract.md`（`shared` の Zod 単一真実・JSON Schema 導出・schema_version 規約）
    - `database.md`（Drizzle・owner_id 必須・インデックス方針・raw_payload 分離）
    - `commit.md`（コミット規約。グローバル設定と非矛盾）
  - **エージェント固有設定**: プロジェクト同梱のエージェント固有設定ファイルは作らない（各自のグローバル設定は環境依存で公開リポに入れない）。AGENTS.md に一本化。
  - 公開リポ方針: 本番/開発の具体情報は含めない。
  - **`.claude-personal/`（追加）**: `.gitignore` 対象のローカル専用ディレクトリ。リポに残したくないルール/情報を置く。AGENTS.md から「**存在すれば参照**」形でリンク。

### prd ディレクトリ構成
- **Q19**: **A**。番号付き分割 + game-domain 独立。
  ```
  prd/
    README.md              # 目的/スコープ(MVP vs Phase2)/アーキ概観/索引
    01-game-domain.md      # ドメイン事実(週/contract=アップグレード/リロール/apocalypse_bonus=Σreward/サンプル/初期カタログ)
    02-architecture.md     # スタック/monorepo/compose watch/依存ポリシー/デプロイ姿勢
    03-data-model.md       # 正規スキーマ/DBテーブル/owner_id/raw_payload分離/インデックス/整合チェック
    04-ingestion.md        # 複数ルート/アダプタ層/レビュー&検証/分析キット配布/段階1〜3
    05-auth-and-privacy.md # better-auth/Google OAuth/プライバシー
    06-analysis.md         # MVP記述分析/Phase2 相関
    07-roadmap.md          # フェーズ分け
  ```
  - `_grilling/decisions.md` は PRD 執筆の原資料。執筆後の扱いは後で決定（経緯ログとして残す or 削除）。

### スクショ画像の保存
- **Q20**: **B（MVP に含める）**。理由: 読み取りミスの事後検証に元スクショ再閲覧が有用（1208/1200 の実例）、後付けは重い。
  - **スクショの役割整理**:
    - MVP: スクショ=**証跡（添付・人間が後から検証で再閲覧）**。解析は依然ユーザー自前 LLM で外部実行→JSON 投入。アプリは画像を**保存するが処理しない**。
    - Phase3: 同じアップロード画像が**サーバ側 LLM の処理入力**に昇格（連続性あり）。
  - 画像は **run に対する任意の添付**（最大3枚: 結果/UPGRADE HISTORY/REWARD LEDGER、section タグ付き）。ファイルインポート経路では画像なしでも run 成立。
  - → 追加 grill: ストレージbackend/抽象、画像データモデル、アクセス制御、制約(形式/サイズ/枚数)、保持/削除。

### 画像ストレージ backend / 抽象化
- **Q21**: **A**。薄い `BlobStore` インターフェース（`put`/`getStream`/`delete`）を噛ませる。
  - MVP: **ローカルファイルボリューム**実装（50〜100行程度、compose に S3 互換サービス不要）。
  - 移行: 同インターフェースを `@aws-sdk/client-s3`（R2 は S3 互換）で実装して差し替え、呼び出し側無変更。
  - 自前実装で十分（要件単純）。代替: `unstorage`(unjs) / `flydrive` 等の抽象化ライブラリも可。
  - **画像配信は必ずアプリのエンドポイント経由**（直リンク禁止）。MVP=ディスクからストリーム、将来=署名 URL へリダイレクト。owner_id 検証を1か所に集約。

### 画像のデータモデル・制約・アクセス制御・保持
- **Q22**: **A**（＋MVP は「各画面1枚」前提）。
  1. **データモデル**: `run_image`(`id`,`owner_id`,`run_id` FK,`section`=`result`|`upgrade_history`|`reward_ledger`|`other`,`storage_key`,`content_type`,`byte_size`,`width`/`height` 任意,`created_at`)。`storage_key`=`BlobStore` キー。
  2. **必須/任意**: 任意。画像なしでも run 成立（ファイルインポート経路を壊さない）。
  3. **制約**: 形式 png/jpeg/webp、1枚最大 10MB。**MVP は section あたり1枚（1 run 最大3枚）**にバリデーション。スキーマ自体は将来の複数枚可。サーバ側で MIME/サイズ検証。
  4. **アクセス制御**: 認証必須エンドポイント経由配信のみ。`run_image.owner_id == セッション owner_id` 検証。直リンク・列挙不可。
  5. **保持/削除**: run 削除で画像もカスケード削除（DB 行＋BlobStore 実体）。単体差し替え/削除可。TTL 自動失効なし（証跡目的）。
  6. **EXIF/プライバシー**: 保存時に EXIF 除去。

### 開発ツールチェーン
- **Q23**: **A**。**Biome**(lint+format 1ツール) + **Vitest**(`shared` のスキーマ/整合チェック/正規化の単体テストに最適) + 各パッケージ `tsc --noEmit`(`pnpm -r typecheck`) + **git フック**。E2E は Playwright で UI 成熟後。
  - **git フック（更新）**: lefthook をやめ、**git 2.55+ の config ベース hooks** を採用（ユーザーが git を 2.55 に更新したため）。`.githooks.gitconfig`(hook 定義) + `.githooks/`(スクリプト) をリポジトリ管理、`pnpm install`(prepare→`.githooks/install.sh`) で `include.path` を冪等設定し有効化。lefthook/husky 依存ゼロ。
    - pre-commit: staged に Biome（依存未導入時/ git<2.55 はスキップ）。pre-push: `pnpm typecheck`。
    - **前提: git >= 2.55**（公開リポなので注記）。`git hook list <event>` は未設定時 exit1 の仕様に注意（能力判定はバージョン比較で行う）。
  - **Biome 注意点**(初採用): 設定 `biome.json(c)`、2.x は monorepo 対応(ルート+パッケージ別override)。**Tailwind クラス並べ替えは `prettier-plugin-tailwindcss` 不可 → Biome `useSortedClasses`(nursery) で対応**。React+TS/JSON はOK。→ `rules/typescript.md` に記載。

### カタログ管理 UI
- **Q24**: **A**。MVP に**最小限**のカタログ管理を含める（名寄せが崩れると Q14 記述分析が成立しないため前提条件）。
  - 操作3つ: **未検証(unverified)一覧表示 / verify マーク / 既存エントリへエイリアス統合(マージ)**。
  - リッチ属性（カテゴリ・色など）は Phase 2。

## スクショ自動解析（2026-07-06 grill・確定）

Phase3 予定だった全自動投入ルートを前倒し。正典は [04-ingestion.md](../04-ingestion.md) §9。

| # | 論点 | 決定 |
|---|---|---|
| 1 | エンティティ | アップロード即、**空 draft run + `analysis_job`**（1:1）。run_image は既存モデルのまま run に紐づけ。run.status は draft/confirmed から拡張しない |
| 2 | 再解析 | 同一 job 行の**再キュー方式**（履歴なし。来歴は run_payload.llm_model） |
| 3 | worker 通信 | **server API を outbound polling**（claim/images/complete/fail）。認証は WORKER_API_TOKEN |
| 4 | ストレージ | BlobStore に **S3 互換アダプタ**追加。本番 R2 / **開発 SeaweedFS**（compose）。local 実装はテスト用に残置。MinIO は不採用 |
| 5 | LLM 入出力 | LLM CLI の非対話実行で **JSON Schema 強制のフラット形**（images 分類 + result + entries + rewards）。CLI・モデル・引数は env 注入（公開リポに固有名を置かない）。プロンプトは analysis-kit 再構成 + few-shot + 乖離検知テスト |
| 6 | 着地 | **厳格ゲート**（error なし・warning なし・全 section・全名称 verified）で自動 confirmed。それ以外 draft。ゆくゆく精度 100% 自動を目指す |
| 7 | 失敗処理 | **自動リトライなし**・即 failed・手動再試行（エラー実態が見えてから自動化検討）。lease 超過も failed 落とし |
| 8 | 権限 | **user.role**（'user'/'admin'）追加。admin ゲート（将来 premium） |
| 9 | worker 形態 | **packages/worker は compose 外・server と分離した実行環境で稼働**（LLM CLI の実行要件のため。具体構成は非公開の運用メモ）。compose から worker 削除 |
| 10 | UI | インポート画面に統合（admin のみ表示）。run 一覧バッジ + 詳細で再解析・手動導線 |

- 却下した代替案: run.status 拡張（ジョブ状態の置き場が結局別に要る）/ 独立 job → 成功時 run 生成（画像付け替えが複雑）/ job 1:N 履歴（個人用途に過剰）/ 既存 bot 基盤への同居（shared 契約に依存できない）/ worker の DB 直結（稼働場所が DB に縛られる）。
- 付随緩和: run_image は 1 run 最大5枚・同一 section 複数可（section は自動ルートでは LLM 分類で埋め戻し）。

## 残りの小論点（PRD 執筆時に既定値で確定予定。異論あれば grill）
- `played_at` の出所: 既定=投入時刻、手動上書き可（スクショに日付なし）。
- run の重複投入: 重複検出はせず許容、手動削除で対応（MVP）。
- MCP/API 具体形: Phase2、設計のみ（`submit_run`/`get_extraction_guide`/`list_catalog`）。
- デプロイ具体（ドメイン/TLS/リバプロ/シークレット）: 公開リポに入れず `.claude-personal/` 管理。PRD は姿勢のみ記述。
- CI: GitHub Actions で typecheck/lint/test（詳細は実装時）。
- Node バージョン: LTS 固定（実装時に確定）。

## 着手状況（Q25: A = 設定ファイル → PRD）
- **設定ファイル一式＋ディレクトリ雛形を作成済み**:
  - ルート: `.gitignore` / `CLAUDE.md`(@AGENTS.md) / `AGENTS.md`(正典リンクハブ) / `pnpm-workspace.yaml`(catalog + minimumReleaseAge 4320 + onlyBuiltDependencies) / `package.json`(monorepo root scripts) / `biome.json`(useSortedClasses 有効) / `tsconfig.base.json` / `lefthook.yml` / `compose.yaml`(db/server/web + worker は profile phase3) / `Dockerfile.dev` / `.env.{database,server,web}.example` / `.vscode/extensions.json`
  - ルール: `.claude/rules/{typescript,schema-and-contract,database,commit}.md`
  - パッケージ雛形: `packages/{shared,database,server,web,worker}`（package.json + tsconfig + src プレースホルダ、`workspace:*` 依存・`catalog:` 参照）
  - PRD 雛形: `prd/README.md` + `prd/01〜07`（章立てのみ）
- **未実施**: `pnpm install`・パッケージ実装。catalog のバージョンは出発点（install 時に minimumReleaseAge 考慮で確定）。
- **次**: PRD 8文書の本文執筆。
- [ ] monorepo パッケージ命名・レイアウト確定。
