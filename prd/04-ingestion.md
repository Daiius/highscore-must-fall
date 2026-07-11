# 04. 投入（ingestion）

本章は「プレイ結果をどうアプリに入れるか」を定める。
データ構造は [03](./03-data-model.md)、ゲーム事実は [01](./01-game-domain.md) を参照。

---

## 1. 設計思想

- **すべての投入ルートは、同一の正規スキーマ（`shared`）に収束する。**
- LLM による画像→構造化は**アダプタとして差し替え可能**にし、その下流（検証→レビュー→保存）は
  投入経路を問わず**共通**にする（[02](./02-architecture.md) §4 の ingestion アダプタ境界）。
- これにより、どの入口から入っても**同じ検証・同じ整合チェック・同じ保存**が効く。

## 2. 投入ルート一覧

| ルート | 対象 | LLM の場所 | 受け口 | フェーズ |
|---|---|---|---|---|
| ファイル/貼り付けインポート | 全員（無料） | ユーザー自前（アプリ外） | Web UI（JSON/YAML） | **MVP** |
| API | パワーユーザー | ユーザー自前 | HTTP（トークン認証） | Phase2（副産物） |
| MCP | 無料 | ユーザー自前 | MCP ツール | Phase2（設計/接続口を先取り） |
| 全自動 | 自分（admin）/将来は有料 | **サーバ側**（worker） | 画像アップロード | **実装中**（Phase3 から前倒し。§9） |

> いずれも生成物は「正規スキーマに準拠した1 run 記録」。LLM 非依存の下流は1つ。

## 3. MVP の流れ（段階1: ファイル/貼り付けインポート）

1. ユーザーは結果画面の3枚スクショを**自前の LLM**（手元の Claude/ChatGPT 等）で解析し、
   正規スキーマ準拠の **JSON（または YAML）** を得る（プロンプトは §6 のキットで配布）。
2. アプリの**インポート画面**に JSON/YAML を貼り付け or ファイルアップロード。
3. （任意）同じ run に**スクショ画像を添付**（証跡。§7）。1 run 最大5枚。
4. サーバは `shared` の Zod で**検証**し、**整合チェック**（`apocalypse_bonus == Σreward.points` 等）を実行。
5. **レビュー画面**で結果を表示。error は確定不可、**warning はインライン表示**して人間が修正。
   - スクショを添付していれば、横に並べて見比べながら直せる（読み取りミスの検証）。
   - 3枚が揃わない等で部分的でも、**ドラフト（`status=draft`）として保存**できる。
6. 問題なければ**確定（`status=confirmed`）** → `run` / `upgrade_entry` / `reward_entry` / `run_payload` に保存、
   未知のアップグレード/リワード名は unverified でカタログに自動登録（[03](./03-data-model.md) §5）。

> ⚠️ MVP の段階1では、アプリは**画像を解析しない**（解析はユーザーの LLM）。画像は証跡として保存するだけ。

## 4. レビュー & 検証層（全ルート共通）

- 入力（JSON/YAML/MCP 引数）→ `shared` Zod 検証 → 整合チェック → （UI なら）レビュー → 確定保存。
- **error**: 型不正・必須欠落・負値等 → 確定不可。
- **warning**: 整合不一致（例 reward 合計 ≠ apocalypse_bonus）→ 確定可だが要確認。レビュー UI で強調。
- ドラフト保存を許容し、後から補完・確定できる（スクショ取得が手間なため運用に優しく）。
  - **後から確定**: run 詳細画面の「確定する」→ `PATCH /api/runs/:id`。確定時は保存済み
    `raw_payload` を現行契約で再検証し、**error があれば確定不可**（部分ドラフト＝緩い
    draft 契約を導入しても確定条件が保たれる）。warning は確定可・表示のみ。冪等。
  - **再ドラフト**: 修正作業のため confirmed → draft に戻せる（同エンドポイント・検証なし。
    詳細画面の ⋮ メニュー「下書きに戻す」）。

## 5. 相互交換フォーマット & バージョニング

- 標準は **JSON**。ファイルインポートは **YAML も受理**（人間が書きやすい。内部で同じ Zod に通す）。
- レコードは **`schema_version`** を持つ。`shared` パッケージは semver。
- 破壊的変更時はバージョンを上げ、`shared` の変換器で旧 `raw_payload` を移行可能にする。

## 6. 分析キット配布（「画面で分析方法を提供」）

ユーザーの自前 LLM に準拠出力をさせるため、アプリは**分析キット**を配る。

- **インポート画面**に以下を提示:
  - 現行 `schema_version` の **JSON Schema**（`shared` から導出）と**ダウンロード**。
  - **抽出手順プロンプト**（週グループと週内順序を保て / reroll は灰色=entry_type=reroll / reward は name·count·points /
    既知カタログ名に寄せろ 等のドメイン指示。[01](./01-game-domain.md) 由来）。
  - （任意）**既知カタログ**の一覧（名寄せ精度向上）。
- ユーザーはこれを自前 LLM にスクショと共に渡し、出力 JSON をインポートする。
- **JSON Schema は `shared`（contract）から導出**され、スキーマ更新に自動追従する。
- **プロンプト・テンプレ・正解例は人手キュレーションの文書**（few-shot の散文・正解例はスキーマから
  機械生成できない）。契約との乖離は**テストで検知**する: 配布プロンプトの EXAMPLE を server の
  ingestion 検証に通し、スキーマ/変換規約の変更で fail させる（生成による自動追従の代わりに
  乖離検知で同じ性質を担保）。

> **具体キット**: [`analysis-kit/`](./analysis-kit/)（[prompt.md](./analysis-kit/prompt.md) / [template.yaml](./analysis-kit/template.yaml) / [example.yaml](./analysis-kit/example.yaml)）。
> 汎用チャット LLM 向けに「最小プロンプト + 記法内包テンプレ + 正解例(few-shot)」でブレを抑える。
> 一発コピペ版はインポート画面の「LLM プロンプトをコピー」で配布（本文の実体と配置理由は
> [analysis-kit/oneshot.md](./analysis-kit/oneshot.md)）。
> 出力のフラット形 `{ week, type, name|flavor }` は、アダプタが `order_in_week` を振るだけで正規スキーマへ 1:1 変換できる。

## 7. 画像アップロード（証跡）

- 1 run に **0〜複数枚**の `run_image` を任意添付（[03](./03-data-model.md) §3.7）。
- 枚数: **1 run 最大5枚・同一 section 複数可**（2026-07-06 緩和。自動解析ルート §9 の「1〜5枚おおらか受理」に合わせた。
  当初 MVP は section ごと1枚・計3枚だった）。
- `section` の決まり方: 手動添付はユーザー指定。自動解析ルートはアップロード時 `other` で保存し、
  LLM の画像分類結果で埋め戻す（§9）。
- 制約: `image/png` `image/jpeg` `image/webp`、1枚 ≤ 10MB。サーバ側で MIME/サイズ検証、**保存時に EXIF 除去**。
- 保存は `BlobStore`（MVP=ローカルボリューム、将来 R2/S3。[02](./02-architecture.md) §7）。
- **配信は認証必須のエンドポイント経由のみ**。`run_image.owner_id == セッション owner_id` を検証。直リンク・列挙不可。
- run 削除で画像もカスケード削除（DB 行＋実体）。TTL 自動失効は設けない（証跡目的）。

## 8. Phase2: MCP / API（設計のみ・接続口を先取り）

- **MCP サーバ**（server に同居 or 分離）が公開するツール:
  - **`submit_run`**: 入力スキーマ = contract の JSON Schema。ユーザーの LLM が直接フィールドを埋めて呼ぶ
    → MCP がスキーマ強制 → サーバ側でも `shared` で再検証して保存（コピペ不要）。
  - **`get_extraction_guide`**: 最新の抽出手順＋ `schema_version` を返す。
  - **`list_catalog`**: 既知の正規名カタログを返す（ユーザー LLM が正規名に寄せて出力できる）。
- **API**: 同一スキーマの HTTP エンドポイント。ユーザー単位トークン（better-auth 発行。[05](./05-auth-and-privacy.md)）。
- いずれも §6 のキットと §4 の検証層を再利用するだけ（契約が1つなので後付けコスト低）。

## 9. 全自動（スクショ自動解析）— 設計確定 2026-07-06

ユーザーがスクショをアップロード → **worker**（server とは分離した実行環境で稼働）がサーバ側 LLM で画像→構造化 → §4 の検証層へ。
MVP で保存していた `run_image` が、そのまま**処理入力**に昇格する（連続性）。
対象は **`user.role = 'admin'`**（将来は課金ユーザーも。[05](./05-auth-and-privacy.md) §6・[07](./07-roadmap.md)）。

### 9.1 フロー全体

```
web: スクショ 1〜5 枚ドロップ（admin のみ表示。インポート画面に統合）
  ↓ POST（枚数 1..5 / MIME / サイズ検証。section は聞かない）
server: 空の draft run（source=screenshot_auto, コア列 NULL）
        + run_image ×N（section=other）+ analysis_job（queued）を作成
  ↓ （worker が outbound polling で claim。worker 側は受け口を持たない）
worker: 画像ダウンロード → LLM CLI 実行（JSON Schema 強制）→ complete / fail
  ↓
server: アダプタ変換 → shared Zod 検証 → run コア列 + entry + payload 更新
        → run_image.section 埋め戻し → 自動確定ゲート判定（§9.4）
  ↓
confirmed（全ゲート通過）or draft（人間が既存レビュー画面で確定）
```

- ジョブ状態は **`analysis_job`**（run と 1:1。[03](./03-data-model.md) §3.8）に持ち、
  `run.status` は draft/confirmed のまま拡張しない。「解析中」「要確認」は job 状態から導出する。
- 再解析は同一 job 行を `queued` に戻す**再キュー方式**（履歴は持たない。来歴は `run_payload.llm_model`）。
  draft の間のみ許可（confirmed は既存の「下書きに戻す」を経由）。

### 9.2 worker

- 実装は [`packages/worker`](../packages/worker)（`shared` 依存）。**compose には含めず、server とは分離した
  実行環境で稼働**させる（LLM CLI の実行要件のため。実行環境・常駐化の具体構成は公開リポに書かず、
  非公開の運用メモ側に記す。[02](./02-architecture.md) §9 と同じ姿勢）。
- server の worker 専用 API を**定期 polling**（outbound のみ）:
  - `claim`（queued を1件、排他的に running へ）/ 画像取得 / `complete`（構造化結果）/ `fail`（エラー内容）。
  - 認証は **`WORKER_API_TOKEN`**（shared secret。env で server / worker 双方に設定）。
- LLM 呼び出しは **CLI ベースの非対話実行**（画像添付・出力 JSON Schema 強制ができること）。
  **使用する CLI・モデル・引数は env で注入**し、公開リポにツール固有名やコマンド形を置かない（具体は運用メモ）。

### 9.3 LLM 入出力契約

- 出力は**フラット形 JSON**（JSON Schema は `shared` から導出・worker 用に固定）:
  - `images[]` … 各画像の section 分類（result / upgrade_history / reward_ledger / other）。
  - `result` … コア指標（読み取れた項目のみ）。
  - `entries[]` … `{ week, type: upgrade|reroll, name|flavor }`（§6 のフラット形と同じ。`order_in_week` はアダプタが付与）。
  - `rewards[]` … `{ name, count, points }`。
- プロンプトは [analysis-kit](./analysis-kit/) のドメイン注意点（リロールは灰色斜体 / points は掛けない /
  綴りそのまま 等）を worker 用に再構成し、few-shot 正解例（JSON）を同梱。
  §6 と同様、**EXAMPLE を server の検証に通す乖離検知テスト**で契約とのズレを検知する。
- server 側でも共通アダプタ → `shared` Zod 検証を必ず通す（worker の出力を信頼しない。§4 と同一の下流）。

### 9.4 自動確定ゲート

以下**すべて**を満たす場合のみ自動で `confirmed`。1つでも欠ければ draft 止まり（人間がレビュー画面で確定）。

1. error なし（型・必須・負値等）
2. warning なし（`apocalypse_bonus == Σreward.points` 等の整合チェック）
3. 全 section 揃い（result / upgrade_history / reward_ledger が各1枚以上に分類された）

**名前に関する条件は置かない**（2026-07-11 変更。旧条件4「全 upgrade/reward 名が verified カタログに一致」を削除）。

> **数値の誤読は分析を直撃するが、名前の誤読は分析を歪めない。** `final_score` が違えば散布図が壊れる。
> 一方、名前を1つ読み違えても、系統構成のバーが1本ぶんズレるだけで、ゲームのランダム性や
> プレイヤーの調子による分散に埋もれる。分析に 100% の精度は求めない（[06](./06-analysis.md) §1.1）。
> **止めるコストが、止めて得られるものに見合わない。**
>
> 旧条件4は名前の誤読対策だったが、`verified` の昇格は開発者がスクショを撮って PR を通す経路しかない
> （[08](./08-catalog-lifecycle.md) §5）ため、**開発者が新要素に到達するまで自動確定が止まり続ける**。
> ゲームのアップデートに開発者が追いつけない期間こそ自動解析が要る局面であり、旧設計はそこで機能を落としていた。
>
> 誤読名は confirmed へ入るが、**回収の網は後段に残る**: `unverified` バッジで語句単位に明示され、
> カタログ管理 UI の未検証一覧に出続け、マージ・孤児掃除の対象であり続ける。分析はキャッシュせず
> 毎回 SQL で集計するので、**直した瞬間に分析へ反映される**（[08](./08-catalog-lifecycle.md) §9）。

### 9.5 失敗処理

- **自動リトライなし**。エラーは即 `failed` + `last_error` 保存（どんなエラーが出るか実態が見えてから自動化を検討）。
- **部分読み取り**（必須指標が null → 変換後に欠落 → 検証 error）も現状は `failed` として扱う
  （幻覚値の混入より欠落の明示を優先。draft 保存で受けるのは**緩い draft 契約**＝部分ドラフト
  保存の導入後。§4 の後続課題）。
- worker クラッシュ等で `running` のまま残ったジョブも lease（`leased_until`）超過で **failed 落とし**（自動再キューしない）。
- UI: run 一覧に「解析待ち / 解析中 / 失敗」バッジ（解析中 run があるときのみ数秒間隔で polling）。
  run 詳細にエラー内容・**再解析ボタン**・手動インポートへの導線（画像は残っているので §6 のキットで自前 LLM に流せる）。
