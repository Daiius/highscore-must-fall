// shared: システムの中心契約（versioned contract）のエントリポイント。
//
// ここに以下を実装していく（詳細は ../../.claude/rules/schema-and-contract.md と prd/03,04）:
//   - 正規スキーマ（Zod）: run レコード / upgrade_entry(entry_type) / reward_entry / catalog
//   - 型の導出（z.infer）と JSON Schema の導出
//   - schema_version と バージョン間変換器
//   - 整合チェックルール（例: apocalypse_bonus === Σ reward.points）
//   - 名寄せ正規化ヘルパー（照合キー生成）
//
// TODO(impl): 実装はスキャフォルド段階のため未着手。

export const SCHEMA_VERSION = '0.1.0' as const
