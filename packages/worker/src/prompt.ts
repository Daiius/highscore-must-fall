// LLM への抽出プロンプト。分析キット（prd/analysis-kit/・oneshot-prompt.txt）のドメイン注意点を
// worker 用（JSON Schema 強制・画像分類つき）に再構成したもの（prd/04 §9.3）。
// 契約（shared の抽出スキーマ）との乖離は __tests__/prompt.test.ts の EXAMPLE 検証で検知する。

/** few-shot 正解例（sample-01。Σpoints = 1208 = apocalypse_bonus で自己整合）。 */
export const EXAMPLE_EXTRACTION = {
  images: [
    { index: 0, section: 'result' },
    { index: 1, section: 'upgrade_history' },
    { index: 2, section: 'reward_ledger' },
  ],
  result: {
    days_survived: 10,
    final_score: 143161,
    aliens_defeated: 1336,
    nukes_launched: 3,
    apocalypse_bonus: 1208,
  },
  upgrade_history: [
    { week: 1, type: 'upgrade', name: 'NUCLEAR WEAPONS LAB', flavor: null },
    { week: 1, type: 'upgrade', name: 'RATIONED WARHEADS', flavor: null },
    { week: 1, type: 'upgrade', name: 'INCREASE PRODUCTION', flavor: null },
    { week: 1, type: 'upgrade', name: 'ARC FLAIL', flavor: null },
    { week: 1, type: 'upgrade', name: 'INCREASE FIRE RATE', flavor: null },
    { week: 1, type: 'upgrade', name: 'REGENERATIVE SHIELD', flavor: null },
    { week: 1, type: 'upgrade', name: 'BLACKOUT PROTOCOL', flavor: null },
    { week: 1, type: 'upgrade', name: 'INSTITUTE OF AUTOMATION', flavor: null },
    { week: 1, type: 'upgrade', name: 'DEPLOY LASER WATCHTOWER', flavor: null },
    { week: 1, type: 'upgrade', name: 'DEPLOY LASER WATCHTOWER', flavor: null },
    { week: 1, type: 'upgrade', name: 'PLASMA PHYSICS LAB', flavor: null },
    { week: 1, type: 'upgrade', name: 'OPTIMIZED OPERATIONS', flavor: null },
    { week: 2, type: 'upgrade', name: 'ADVANCED MATERIALS LAB', flavor: null },
    { week: 2, type: 'reroll', name: null, flavor: 'DIGITIZE CONSCIOUSNESS' },
    { week: 2, type: 'upgrade', name: 'EXTENDED FLAIL', flavor: null },
    { week: 2, type: 'upgrade', name: 'CONTEXT SWITCH', flavor: null },
    { week: 2, type: 'reroll', name: null, flavor: 'WELCOMING CEREMONY' },
    { week: 2, type: 'upgrade', name: 'OFFENSIVE INNOVATION CENTER', flavor: null },
    { week: 2, type: 'upgrade', name: 'COBALT COIL GUN', flavor: null },
  ],
  reward_ledger: [
    { name: 'BOHEMIAN', count: 1, points: 250 },
    { name: 'OBSESSIVE', count: 21, points: 168 },
    { name: "CHEF'S KISS", count: 7, points: 140 },
    { name: 'CONSERVATION', count: 3, points: 120 },
    { name: 'NO ESCAPE', count: 3, points: 90 },
    { name: 'LASER DISCO', count: 3, points: 90 },
    { name: 'DISCIPLINE', count: 7, points: 70 },
    { name: 'ANNIHILATION', count: 13, points: 65 },
    { name: 'COMPLETIST', count: 11, points: 55 },
    { name: 'MINT CONDITION', count: 2, points: 50 },
    { name: 'GONNAHAVEMESOMEFUN', count: 2, points: 40 },
    { name: 'HARD CHEESE', count: 4, points: 40 },
    { name: 'CLOSE SHAVE', count: 1, points: 30 },
  ],
} as const

/**
 * 抽出プロンプトを組み立てる。画像は与えた順に index 0..N-1（ファイルパスも列挙し、
 * 添付渡し・ファイル読み取りのどちらの CLI でも同じ index 対応が成立するようにする）。
 */
export function buildExtractionPrompt(imagePaths: string[]): string {
  const imageList = imagePaths.map((p, i) => `  ${i}: ${p}`).join('\n')
  return `Utopia Must Fall のリザルト系スクリーンショット ${imagePaths.length} 枚を読み取り、指定の JSON Schema に従う JSON だけを出力して。
画像は与えた順に index 0〜${imagePaths.length - 1}。ファイルパス（index 順）:
${imageList}

読み取りルール厳守：
1. まず images に各画像の分類を入れる（結果画面=result / UPGRADE HISTORY=upgrade_history / REWARD LEDGER=reward_ledger / どれでもない=other）。
2. 名前は画面の綴りを一字一句そのまま（似た語に直さない・略さない。例: DIGITIZE を DIGITAL にしない）。
3. UPGRADE HISTORY は週ごと・画面の並び順のまま全行。同名の連続もそのまま重複させる。
4. UPGRADE HISTORY は2列レイアウト。読む順序は「左列を上から下へ → 右列を上から下へ」。
   各行は直前に現れた WEEK 見出しに属する。WEEK 見出しが列の末尾にある場合、
   その週のエントリは次の列の先頭に続く。出力前に週ごとの行数を見直し、1つの週だけ極端に多ければ読み直す。
5. 灰色斜体の行はリロール → { "week": N, "type": "reroll", "name": null, "flavor": "<その灰色テキスト>" }。
   色付きの行は type: "upgrade"（flavor は null）。
6. REWARD LEDGER の points は行に表示された数値（その報酬の合計点）。count（○×）とは掛けない。
7. 出力前に reward の points 合計 = apocalypse_bonus（☆合計）が一致するか確認。ズレたら読み直す。
8. 読み取れない値は憶測せず null（該当画像が無い場合の result 指標も null）。名前が読めない reward 行は出力しない。

EXAMPLE（読み取り結果の見本。あなたのスクショの内容に置き換える）:
${JSON.stringify(EXAMPLE_EXTRACTION, null, 2)}
`
}
