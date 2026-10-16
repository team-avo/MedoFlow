import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type {
  FileStorageDriver,
  PresignedUpload,
  UploadUrlOptions,
  DownloadUrlOptions,
} from './types'

/** Local-disk store root. Development and CI only — refused at production boot. */
export const UPLOAD_BASE = path.resolve(process.cwd(), 'uploads')

export const BLOB_ROUTE = '/api/v1/files/blob'

/**
 * What a local presigned token authorises. Mirrors what an S3 signature
 * covers: one object, one operation, an expiry, and (for uploads) the exact
 * content type and length.
 */
export interface BlobGrant {
  k: string
  op: 'put' | 'get'
  exp: number
  ct: string
  len?: number
}

export class BlobTokenError extends Error {
  statusCode = 403
  code = 'invalid_file_url'
  constructor(reason: string) {
    super(`File URL is invalid or has expired (${reason})`)
  }
}

// A per-process secret is fine for development: URLs live for minutes.
let processSecret: string | null = null
const signingSecret = (): string =>
  process.env.FILE_BLOB_SIGNING_SECRET || (processSecret ??= crypto.randomBytes(32).toString('hex'))

const sign = (payload: string): string =>
  crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url')

export function signBlobGrant(grant: BlobGrant): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyBlobToken(token: string, op: BlobGrant['op'], now = Date.now()): BlobGrant {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) throw new BlobTokenError('malformed')
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    throw new BlobTokenError('signature')
  }
  let grant: BlobGrant
  try {
    grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as BlobGrant
  } catch {
    throw new BlobTokenError('malformed')
  }
  if (grant.op !== op) throw new BlobTokenError('operation')
  if (!(grant.exp > now)) throw new BlobTokenError('expired')
  return grant
}

/** Resolves a key under UPLOAD_BASE, refusing anything that escapes it. */
export function resolveLocalPath(key: string): string {
  const resolved = path.resolve(UPLOAD_BASE, key)
  if (!resolved.startsWith(UPLOAD_BASE + path.sep)) {
    throw new BlobTokenError('path')
  }
  return resolved
}

export class LocalFileStorage implements FileStorageDriver {
  readonly kind = 'local' as const

  refFor(key: string): string {
    return `local:${key}`
  }

  createUploadUrl(key: string, opts: UploadUrlOptions): Promise<PresignedUpload> {
    const token = signBlobGrant({
      k: key,
      op: 'put',
      exp: Date.now() + opts.expiresIn * 1000,
      ct: opts.contentType,
      len: opts.contentLength,
    })
    return Promise.resolve({
      url: `${opts.baseUrl}${BLOB_ROUTE}/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': opts.contentType },
    })
  }

  createDownloadUrl(key: string, opts: DownloadUrlOptions): Promise<string> {
    const token = signBlobGrant({
      k: key,
      op: 'get',
      exp: Date.now() + opts.expiresIn * 1000,
      ct: opts.contentType,
    })
    return Promise.resolve(`${opts.baseUrl}${BLOB_ROUTE}/${token}`)
  }

  head(key: string): Promise<{ size: number } | null> {
    const p = resolveLocalPath(key)
    return Promise.resolve(fs.existsSync(p) ? { size: fs.statSync(p).size } : null)
  }

  readHead(key: string, bytes: number): Promise<Buffer> {
    const fd = fs.openSync(resolveLocalPath(key), 'r')
    try {
      const buf = Buffer.alloc(bytes)
      const n = fs.readSync(fd, buf, 0, bytes, 0)
      return Promise.resolve(buf.subarray(0, n))
    } finally {
      fs.closeSync(fd)
    }
  }

  delete(key: string): Promise<void> {
    fs.rmSync(resolveLocalPath(key), { force: true })
    return Promise.resolve()
  }

  putObject(key: string, body: Buffer, _contentType: string): Promise<void> {
    this.write(key, body)
    return Promise.resolve()
  }

  /** Writes an uploaded body (called by the blob route after token checks). */
  write(key: string, body: Buffer): void {
    const p = resolveLocalPath(key)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
}
