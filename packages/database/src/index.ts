// database: Drizzle スキーマ・DB クライアントのエントリポイント。
//
// ここに以下を実装していく（詳細は ../../.claude/rules/database.md と prd/03）:
//   - テーブル: run / run_payload(raw_payload 分離) / upgrade_entry / reward_entry /
//             upgrade_catalog / reward_catalog / run_image / (auth テーブルは better-auth)
//   - 全テーブルに owner_id、複合インデックス先頭に owner_id
//   - DB クライアント生成（mysql2 + drizzle）
//
// TODO(impl): スキャフォルド段階のため未着手。

export {}
