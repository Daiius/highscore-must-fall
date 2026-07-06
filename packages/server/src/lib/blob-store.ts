// BlobStore（画像実体の保存先抽象）。prd/02 §7。
//
//   - `local`: ローカルファイルボリューム実装。ユニットテストと S3 互換サービスを
//     立てない場面のフォールバック。
//   - `s3`   : S3 互換アダプタ（本番 Cloudflare R2 / 開発 SeaweedFS）。endpoint/credentials は
//     env 注入で、切り替えはコード無変更（BLOB_STORE=local|s3）。
//
// 配信は必ずアプリのエンドポイント経由（owner_id 検証を route 側に集約。直リンク不可）。

import { createReadStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

export interface BlobStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>
  /** 実体をストリームで返す。存在しなければ throw（route 側で 404 に変換する）。 */
  getStream(key: string): Promise<ReadableStream<Uint8Array>>
  delete(key: string): Promise<void>
}

/** キーはアプリが生成する（`runs/<runId>/<imageId>.<ext>`）。想定文字以外は実装バグとして拒否。 */
const KEY_PATTERN = /^[A-Za-z0-9/_.-]+$/

function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`unsafe blob key: ${key}`)
  }
}

// --- local 実装 -----------------------------------------------------------------------

export class LocalBlobStore implements BlobStore {
  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    assertSafeKey(key)
    const abs = path.resolve(this.baseDir, key)
    // 念のため base 配下であることを確認する（assertSafeKey と二重の防御）。
    if (!abs.startsWith(path.resolve(this.baseDir) + path.sep)) {
      throw new Error(`blob key escapes base dir: ${key}`)
    }
    return abs
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const file = this.resolve(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
  }

  async getStream(key: string): Promise<ReadableStream<Uint8Array>> {
    const stream = createReadStream(this.resolve(key))
    // open 失敗（ENOENT 等）を Promise の reject として顕在化させてから web stream へ変換する。
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', reject)
    })
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true })
  }
}

// --- S3 互換実装（R2 / SeaweedFS）------------------------------------------------------

interface S3Config {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** 開発（SeaweedFS）でバケットを自動作成する。R2 では事前作成のため通常 false。 */
  ensureBucket: boolean
}

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client
  private ensured: Promise<void> | null = null

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      // R2・SeaweedFS とも path-style でアクセスできる（virtual-host 形式の DNS 前提を外す）。
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  /** 初回アクセス時に一度だけバケット作成を試みる（既存なら成功扱い）。 */
  private ensureBucketOnce(): Promise<void> {
    if (!this.config.ensureBucket) return Promise.resolve()
    this.ensured ??= this.client
      .send(new CreateBucketCommand({ Bucket: this.config.bucket }))
      .then(() => undefined)
      .catch((e: unknown) => {
        const name = (e as { name?: string }).name
        if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return
        this.ensured = null // 一時エラーは次回の再試行に委ねる。
        throw e
      })
    return this.ensured
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key)
    await this.ensureBucketOnce()
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    )
  }

  async getStream(key: string): Promise<ReadableStream<Uint8Array>> {
    assertSafeKey(key)
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    )
    if (!res.Body) throw new Error(`empty blob body: ${key}`)
    return res.Body.transformToWebStream() as ReadableStream<Uint8Array>
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }))
  }
}

// --- 選択（env）------------------------------------------------------------------------

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required when BLOB_STORE=s3`)
  return value
}

function createBlobStore(): BlobStore {
  const kind = process.env.BLOB_STORE ?? 'local'
  if (kind === 's3') {
    return new S3BlobStore({
      endpoint: requiredEnv('S3_ENDPOINT'),
      bucket: requiredEnv('S3_BUCKET'),
      region: process.env.S3_REGION ?? 'auto',
      accessKeyId: requiredEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('S3_SECRET_ACCESS_KEY'),
      ensureBucket: process.env.S3_ENSURE_BUCKET === 'true',
    })
  }
  if (kind !== 'local') throw new Error(`unknown BLOB_STORE: ${kind}`)
  // compose では named volume（blob-data）を packages/server/.blob にマウントする。
  return new LocalBlobStore(process.env.BLOB_LOCAL_DIR ?? '.blob')
}

export const blobStore: BlobStore = createBlobStore()
