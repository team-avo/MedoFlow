import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  FileStorageDriver,
  PresignedUpload,
  UploadUrlOptions,
  DownloadUrlOptions,
} from './types'

export type SseMode = 'AES256' | 'aws:kms' | 'provider-default'

/**
 * Server-side encryption requested on every write (B3.1).
 *  - AES256 / aws:kms  — AWS S3 (and S3-compatible stores that honour the header)
 *  - provider-default  — the store always encrypts at rest and rejects the
 *                        header, e.g. Cloudflare R2 (AES-256, always on)
 */
export function getSseMode(env: NodeJS.ProcessEnv = process.env): SseMode {
  const v = (env.S3_SSE || 'AES256').trim()
  if (v === 'AES256' || v === 'aws:kms' || v === 'provider-default') return v
  throw new Error(`S3_SSE must be AES256, aws:kms or provider-default (got "${v}")`)
}

export function sseParams(env: NodeJS.ProcessEnv = process.env): {
  ServerSideEncryption?: ServerSideEncryption
  SSEKMSKeyId?: string
} {
  const mode = getSseMode(env)
  if (mode === 'provider-default') return {}
  if (mode === 'aws:kms') {
    return {
      ServerSideEncryption: 'aws:kms',
      ...(env.S3_SSE_KMS_KEY_ID ? { SSEKMSKeyId: env.S3_SSE_KMS_KEY_ID } : {}),
    }
  }
  return { ServerSideEncryption: 'AES256' }
}

export function isS3Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)
}

export function createS3Client(env: NodeJS.ProcessEnv = process.env): S3Client {
  return new S3Client({
    region: env.S3_REGION || 'us-east-1',
    ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT, forcePathStyle: true }),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
    // Otherwise the SDK signs a CRC32 of the *empty* presign body into
    // upload URLs and the store rejects the real upload's checksum.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404
}

export class S3FileStorage implements FileStorageDriver {
  readonly kind = 's3' as const

  constructor(
    private readonly client: S3Client,
    readonly bucket: string,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  refFor(key: string): string {
    return `s3:${this.bucket}:${key}`
  }

  async createUploadUrl(key: string, opts: UploadUrlOptions): Promise<PresignedUpload> {
    const sse = sseParams(this.env)
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
      ...sse,
    })
    // Content-Type, Content-Length and the SSE headers are signed: a body of
    // a different size or type, or an upload without encryption, fails the
    // signature check at the bucket.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: opts.expiresIn,
      signableHeaders: new Set(['content-type', 'content-length']),
    })
    const headers: Record<string, string> = { 'Content-Type': opts.contentType }
    if (sse.ServerSideEncryption) headers['x-amz-server-side-encryption'] = sse.ServerSideEncryption
    if (sse.SSEKMSKeyId) headers['x-amz-server-side-encryption-aws-kms-key-id'] = sse.SSEKMSKeyId
    return { url, method: 'PUT', headers }
  }

  async createDownloadUrl(key: string, opts: DownloadUrlOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: opts.contentType,
        // No filename: the client names the download locally (F3.3).
        ResponseContentDisposition: 'attachment',
        ResponseCacheControl: 'no-store',
      }),
      { expiresIn: opts.expiresIn }
    )
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return { size: res.ContentLength ?? 0 }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async readHead(key: string, bytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` })
    )
    const chunks: Uint8Array[] = []
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
    return Buffer.concat(chunks).subarray(0, bytes)
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...sseParams(this.env),
      })
    )
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
