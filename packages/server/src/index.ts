// server: Hono(RPC) API のエントリポイント。
//
// ここに以下を実装していく（詳細は prd/04,05 と .claude/rules）:
//   - better-auth（Google OAuth）
//   - ingestion アダプタ層（ファイル/インポート・将来の MCP/API）と shared の検証・整合チェック
//   - run / catalog / 画像配信（owner_id 検証, BlobStore 経由）の API
//   - 分析キット配布（プロンプト＋JSON Schema）
//
// TODO(impl): スキャフォルド段階のため未着手。

const port = Number(process.env.PORT ?? 4000)
console.log(`[server] scaffold. will listen on ${port}`)
