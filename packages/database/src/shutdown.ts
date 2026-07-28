// 一発限りの CLI（migrate / seed）の終了処理。**使い捨てコンテナを確実に終わらせる**ためにある。
//
// ⚠ `client` は mysql2 の **callback API の Pool**（`mysql2/promise` ではない）なので、
// `end()` の戻り値は `void` である。**`await client.end()` は待っているように見えて待っていない**
// ——完了は callback でしか受け取れない。ここで callback を Promise に包んで初めて実際に待てる。
//
// ただし素直に待ち切ると、close が返らないケースでプロセスが止まらない（同一スタックの
// seseraki で、tunnel 越しに実際に踏んだ）。かといって待たずに exit すると、通常時に接続を
// graceful に閉じられない。**上限時間を設けて閉じ、間に合わなければ諦めて exit する**のが両立の形。
//
// ここに到達する時点で本体の処理（migrate/seed）は完了しコミット済みなので、接続の閉じ方は
// 結果に影響しない——**終わらないことだけが問題**である。

import type { Pool } from 'mysql2'

/** 終了処理の上限。通常の close はミリ秒で返るので、これは待ち時間ではなく「ハングの検知」。 */
const CLOSE_TIMEOUT_MS = 5_000

/**
 * プールを上限付きで閉じてからプロセスを終了する。**この関数は返らない。**
 *
 * close が失敗しても exit コードは変えない（本体の成否だけが呼び出し側の関心事であり、
 * 後始末の失敗で成功を失敗に見せない）。
 */
export async function shutdown(code: number, pool: Pool): Promise<never> {
  const closed = new Promise<void>((resolve) => {
    pool.end(() => resolve())
  })
  // timer は unref して、close が先に返ったときにプロセスを引き止めないようにする。
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, CLOSE_TIMEOUT_MS).unref()
  })
  await Promise.race([closed, timeout])
  process.exit(code)
}
