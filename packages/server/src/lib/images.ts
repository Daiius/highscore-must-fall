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
  const image = sharp(input).rotate()
  const metadata = await image.metadata().catch(() => null)
  const format = metadata?.format
  if (!metadata || !format || !(format in ALLOWED_FORMATS)) {
    throw new ImageValidationError('画像は PNG / JPEG / WebP のみ受理します')
  }
  const allowed = ALLOWED_FORMATS[format as AllowedFormat]
  const { data, info } = await image
    .toFormat(format as AllowedFormat)
    .toBuffer({ resolveWithObject: true })
  return {
    data,
    contentType: allowed.contentType,
    ext: allowed.ext,
    width: info.width,
    height: info.height,
  }
}

/** 入力画像の検証エラー（route が 422 に変換する）。 */
export class ImageValidationError extends Error {}
