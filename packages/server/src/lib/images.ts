// 画像のサニタイズ（prd/04 §7）。
//   - 実フォーマット検証: クライアント申告の MIME は信用せず、sharp のデコード結果で判定する。
//   - EXIF 等メタデータの除去: sharp の再エンコードは既定でメタデータを引き継がない。
//     JPEG は orientation を先に焼き込む（rotate()）ことで EXIF 除去後も向きを保つ。
//   - 寸法取得: run_image.width/height 用。

import sharp from 'sharp'

/** 受理する画像フォーマット（sharp の format 名 → 保存する MIME / 拡張子）。 */
const ALLOWED_FORMATS = {
  png: { contentType: 'image/png', ext: 'png' },
  jpeg: { contentType: 'image/jpeg', ext: 'jpg' },
  webp: { contentType: 'image/webp', ext: 'webp' },
} as const

type AllowedFormat = keyof typeof ALLOWED_FORMATS

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 1枚 ≤ 10MB（prd/04 §7）
export const MAX_IMAGES_PER_RUN = 5 // 1 run 最大5枚（prd/04 §7）
// 入力画素数の上限（デコード爆弾・過大メモリ対策）。スクショには十分な 40MP。
export const MAX_IMAGE_PIXELS = 40_000_000

export interface SanitizedImage {
  data: Buffer
  contentType: string
  ext: string
  width: number
  height: number
}

/** 入力が受理フォーマットの画像かをデコードで確かめ、メタデータを落として再エンコードする。 */
export async function sanitizeImage(input: Uint8Array): Promise<SanitizedImage> {
  // EXIF orientation を画素に焼き込む（メタデータを落としても向きが変わらないように）。
  // limitInputPixels でデコード段階から過大画像を弾く（sharp 既定より厳しめ）。
  const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate()
  const metadata = await image.metadata().catch(() => null)
  const format = metadata?.format
  if (!metadata || !format || !(format in ALLOWED_FORMATS)) {
    throw new ImageValidationError('画像は PNG / JPEG / WebP のみ受理します')
  }
  if (metadata.width && metadata.height && metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new ImageValidationError('画像の解像度が大きすぎます')
  }
  const allowed = ALLOWED_FORMATS[format as AllowedFormat]
  // デコード失敗・limitInputPixels 超過などは null にして 422 に落とす。
  const encoded = await image
    .toFormat(format as AllowedFormat)
    .toBuffer({ resolveWithObject: true })
    .catch(() => null)
  if (!encoded) {
    throw new ImageValidationError('画像を処理できませんでした')
  }
  // 再エンコード後の実バイト数も上限内であることを保証する（入力が小さくても膨らみ得る）。
  if (encoded.data.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageValidationError('画像サイズが上限（10MB）を超えています')
  }
  return {
    data: encoded.data,
    contentType: allowed.contentType,
    ext: allowed.ext,
    width: encoded.info.width,
    height: encoded.info.height,
  }
}

/** 入力画像の検証エラー（route が 422 に変換する）。 */
export class ImageValidationError extends Error {}
