// 初期カタログ等のシード投入。
//
// 初期 seed = サンプル由来のみ（prd/01-game-domain.md）:
//   - upgrade_catalog: 16 種（リロール名は含めない）
//   - reward_catalog: 13 種
//
// TODO(impl): スキャフォルド段階のため未着手。

async function main() {
  // TODO: drizzle クライアントで upsert
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
