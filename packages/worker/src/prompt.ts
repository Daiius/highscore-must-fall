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

/** LLM へ渡す画像 1 枚。列画像は元画像からの派生であることを持つ。 */
export interface PromptImage {
  path: string
  /** 列画像のときだけ: 元画像の index（0 始まり）と、左からの列番号（1 始まり）。 */
  derived?: { sourceIndex: number; column: number }
}

/**
 * 多列レイアウトの読み取りルール。列画像を併送できたかで書き分ける。
 *
 * 列画像がある場合、読む順序は画像の並びそのものになるので曖昧さが無い。無い場合は
 * 1 枚の中で列を辿らせるしかなく、**列数を決め打つと後ろの週が前の週へ吸い込まれる**
 * （実測: WEEK 5 の 11 行が丸ごと WEEK 4 に混入）ので、列数を仮定しない書き方にする。
 */
function columnRule(originalCount: number, hasColumns: boolean): string {
  if (!hasColumns) {
    return `4. UPGRADE HISTORY は複数列レイアウト（列数は画面ごとに違う。2 列とは限らず 3 列以上のこともある）。
   まず列が何本あるか数える。読む順序は「いちばん左の列を上から下まで読み切る → 次の列の最上段へ移る」を
   最後の列まで繰り返す。行方向に横切って読まない。
   各行は「その行より前（同じ列の上、または前の列）に最後に現れた WEEK 見出し」に属する。
   列の先頭に WEEK 見出しが無ければ、その列の先頭行は前の列の最後の週の続きである。
   1 つの週が列を跨いで分かれるのは普通に起きる（見出しの下に数行だけ置いて列が尽き、残りが次の列の先頭へ続く）。`
  }
  return `4. index ${originalCount} 以降は、元のスクショを**列ごとに切り出して拡大した画像**（どの画像のどの列かは
   上のリストに書いてある）。UPGRADE HISTORY と REWARD LEDGER の**行はこの列画像から読む**
   （字が大きく、読む順序が一意に決まる）。元画像は分類と全体の確認にだけ使う。
   同じ元画像から作った列画像は左の列から順に並ぶ。1 枚ずつ上から下まで読み切り、
   その順に繋げると画面の並び順になる。行方向に横切って読まない。
   各行は「その行より前（同じ列画像の上、または前の列画像）に最後に現れた WEEK 見出し」に属する。
   列画像の先頭に WEEK 見出しが無ければ、その先頭行は前の列画像の最後の週の続きである。
   1 つの週が列画像を跨いで分かれるのは普通に起きる。`
}

/**
 * 抽出プロンプトを組み立てる。画像は与えた順に index 0..N-1（ファイルパスも列挙し、
 * 添付渡し・ファイル読み取りのどちらの CLI でも同じ index 対応が成立するようにする）。
 *
 * 列画像（`derived`）は元画像の**後ろに**並べること。`images` の分類は元画像の index に
 * 対して行わせる必要があり、worker はその index で run_image を引き直す（prd/04 §9.1）。
 */
export function buildExtractionPrompt(images: PromptImage[]): string {
  const originalCount = images.filter((image) => !image.derived).length
  const hasColumns = images.length > originalCount
  const imageList = images
    .map((image, i) => {
      const note = image.derived
        ? `   ← index ${image.derived.sourceIndex} の左から ${image.derived.column} 列目（拡大）`
        : ''
      return `  ${i}: ${image.path}${note}`
    })
    .join('\n')
  const classifyTarget = hasColumns ? `元のスクショ（index 0〜${originalCount - 1}）だけ` : '各画像'
  return `Utopia Must Fall のリザルト系スクリーンショット ${originalCount} 枚を読み取り、指定の JSON Schema に従う JSON だけを出力して。
画像は与えた順に index 0〜${images.length - 1}。ファイルパス（index 順）:
${imageList}

読み取りルール厳守：
1. images には${classifyTarget}の分類を入れる（結果画面=result / UPGRADE HISTORY=upgrade_history / REWARD LEDGER=reward_ledger / どれでもない=other）。
2. 名前は画面の綴りを一字一句そのまま（似た語に直さない・略さない。例: DIGITIZE を DIGITAL にしない）。
3. UPGRADE HISTORY は週ごと・画面の並び順のまま全行。同名の連続もそのまま重複させる。
${columnRule(originalCount, hasColumns)}
5. 灰色斜体の行はリロール → { "week": N, "type": "reroll", "name": null, "flavor": "<その灰色テキスト>" }。
   色付きの行は type: "upgrade"（flavor は null）。
6. REWARD LEDGER の points は行に表示された数値（その報酬の合計点）。count（○×）とは掛けない。
7. 出力前に reward の points 合計 = apocalypse_bonus（☆合計）が一致するか確認。ズレたら読み直す。
8. 読み取れない値は憶測せず null（該当画像が無い場合の result 指標も null）。名前が読めない reward 行は出力しない。
9. 結果画面の数値は桁数を数えてから書く（末尾の 0 を落とさない。例: 80 を 0 にしない）。
10. UPGRADE HISTORY の出力前に自己チェックする。1つでも合わなければ画像を見直す：
   - 出力に現れる週の集合が、画面に見えた WEEK 見出しの集合と一致するか。
   - 週番号が出力順に単調非減少か。
   - 最終週より前に、極端に行数の少ない週（1〜2 行）が無いか。あれば列跨ぎの続きを取りこぼしている。
   - 逆に1つの週だけ極端に多くないか。あれば次の週の見出しを見落として吸い込んでいる。${
     hasColumns
       ? '\n   - どの列画像も丸ごと落としていないか（全ての列画像の行が出力に入っているか）。'
       : ''
}

EXAMPLE（読み取り結果の見本。あなたのスクショの内容に置き換える）:
${JSON.stringify(EXAMPLE_EXTRACTION, null, 2)}
`
}
