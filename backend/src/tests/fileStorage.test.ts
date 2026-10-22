/**
 * B3.1 / F3.3 — object storage for patient files: presigned URLs are
 * time-limited, carry SSE and no filename; the local driver's tokens behave
 * like S3 signatures; content sniffing; production refuses local storage.
 */
import crypto from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  S3FileStorage,
  sseParams,
  getSseMode,
  createS3Client,
} from '../services/fileStorage/s3Driver'
import {
  LocalFileStorage,
  signBlobGrant,
  verifyBlobToken,
  resolveLocalPath,
} from '../services/fileStorage/localDriver'
import { patientFileKey } from '../services/fileStorage/types'
import { contentMatchesMime } from '../utils/fileSniff'
import { isMimeAllowed, getFileUrlTtlSeconds } from '../config/fileConstants'
import { createUploadIntentSchema } from '../validation/fileSchemas'
import { collectEnvProblems } from '../config/envValidation'

afterEach(() => vi.unstubAllEnvs())

const client = createS3Client({
  S3_REGION: 'auto',
  S3_ENDPOINT: 'https://acct.r2.example.test',
  S3_ACCESS_KEY_ID: 'AKIDSYNTHETIC',
  S3_SECRET_ACCESS_KEY: 'synthetic-secret',
} as NodeJS.ProcessEnv)
const PHI_NAME = 'Quinn-Marlowe-HIV-result.pdf'
const key = patientFileKey('clinic_1', 'patient_1', '7d1c7f3e-0000-4000-8000-000000000001')

describe('S3 presigned URLs', () => {
  it('upload URL: time-limited, SSE requested, size and type signed, no filename', async () => {
    const s3 = new S3FileStorage(client, 'medoflow-files', {
      S3_SSE: 'AES256',
    } as NodeJS.ProcessEnv)
    const up = await s3.createUploadUrl(key, {
      contentType: 'application/pdf',
      contentLength: 1234,
      expiresIn: 300,
      baseUrl: 'http://api',
    })
    const u = new URL(up.url)
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300')
    const signed = u.searchParams.get('X-Amz-SignedHeaders')!.split(';')
    expect(signed).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'x-amz-server-side-encryption'])
    )
    // No checksum of the empty presign body baked into the URL.
    expect([...u.searchParams.keys()].some((k) => k.startsWith('x-amz-checksum'))).toBe(false)
    expect(up.url).not.toContain('Quinn')
    expect(up.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'AES256',
    })
  })

  it('R2 (provider-default SSE): no SSE header to send', async () => {
    const s3 = new S3FileStorage(client, 'medoflow-files', {
      S3_SSE: 'provider-default',
    } as NodeJS.ProcessEnv)
    const up = await s3.createUploadUrl(key, {
      contentType: 'image/png',
      contentLength: 10,
      expiresIn: 60,
      baseUrl: '',
    })
    expect(up.headers).toEqual({ 'Content-Type': 'image/png' })
    expect(new URL(up.url).searchParams.get('X-Amz-SignedHeaders')).not.toMatch(/encryption/)
  })

  it('download URL: forces the stored type, attachment with no filename', async () => {
    const s3 = new S3FileStorage(client, 'medoflow-files')
    const url = new URL(
      await s3.createDownloadUrl(key, { contentType: 'image/png', expiresIn: 120, baseUrl: '' })
    )
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(url.searchParams.get('response-content-type')).toBe('image/png')
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment')
    expect(url.pathname).toBe(`/medoflow-files/${key}`)
  })

  it('SSE modes: AES256 default, aws:kms with key id, provider-default (R2) sends none', () => {
    expect(getSseMode({} as NodeJS.ProcessEnv)).toBe('AES256')
    expect(
      sseParams({ S3_SSE: 'aws:kms', S3_SSE_KMS_KEY_ID: 'kms-1' } as NodeJS.ProcessEnv)
    ).toEqual({ ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'kms-1' })
    expect(sseParams({ S3_SSE: 'provider-default' } as NodeJS.ProcessEnv)).toEqual({})
    expect(() => getSseMode({ S3_SSE: 'none' } as NodeJS.ProcessEnv)).toThrow()
  })

  it('URL lifetime defaults to 5 minutes and is capped at 15', () => {
    expect(getFileUrlTtlSeconds({} as NodeJS.ProcessEnv)).toBe(300)
    expect(getFileUrlTtlSeconds({ FILE_URL_TTL_SECONDS: '86400' } as NodeJS.ProcessEnv)).toBe(900)
    expect(getFileUrlTtlSeconds({ FILE_URL_TTL_SECONDS: '-1' } as NodeJS.ProcessEnv)).toBe(300)
  })
})

describe('local presigned tokens (dev / CI stand-in for the bucket)', () => {
  it('a token authorises one operation on one key until it expires', () => {
    const now = Date.now()
    const t = signBlobGrant({ k: key, op: 'get', exp: now + 1000, ct: 'application/pdf' })
    expect(verifyBlobToken(t, 'get', now).k).toBe(key)
    expect(() => verifyBlobToken(t, 'put', now)).toThrow(/operation/)
    expect(() => verifyBlobToken(t, 'get', now + 2000)).toThrow(/expired/)
  })

  it('a tampered token is refused', () => {
    const t = signBlobGrant({ k: key, op: 'get', exp: Date.now() + 60_000, ct: 'image/png' })
    const [payload, sig] = t.split('.')
    const other = Buffer.from(
      JSON.stringify({
        k: 'patient-files/other/x',
        op: 'get',
        exp: Date.now() + 60_000,
        ct: 'image/png',
      })
    ).toString('base64url')
    expect(() => verifyBlobToken(`${other}.${sig}`, 'get')).toThrow(/signature/)
    expect(() => verifyBlobToken(`${payload}.AAAA`, 'get')).toThrow(/signature/)
  })

  it('keys cannot escape the upload root', () => {
    expect(() => resolveLocalPath('../../etc/passwd')).toThrow()
    expect(resolveLocalPath(key)).toContain('patient-files')
  })

  it('URLs carry an opaque token, never the filename', async () => {
    const local = new LocalFileStorage()
    const up = await local.createUploadUrl(key, {
      contentType: 'application/pdf',
      contentLength: 10,
      expiresIn: 300,
      baseUrl: 'http://api',
    })
    expect(up.url).toMatch(/^http:\/\/api\/api\/v1\/files\/blob\//)
    expect(up.url).not.toContain(PHI_NAME)
    expect(local.refFor(key)).toBe(`local:${key}`)
  })
})

describe('content checks', () => {
  const PDF = Buffer.from('%PDF-1.7\n...')
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
  const HTML = Buffer.from('<!doctype html><script>alert(1)</script>')

  it('accepts files whose bytes match the declared type', () => {
    expect(contentMatchesMime(PDF, 'application/pdf', PDF.length)).toBe(true)
    expect(contentMatchesMime(PNG, 'image/png', PNG.length)).toBe(true)
    expect(contentMatchesMime(Buffer.from('a,b\n1,2\n'), 'text/csv', 8)).toBe(true)
  })

  it('rejects mismatches, HTML disguised as text, and binary text', () => {
    expect(contentMatchesMime(HTML, 'application/pdf', HTML.length)).toBe(false)
    expect(contentMatchesMime(PDF, 'image/png', PDF.length)).toBe(false)
    expect(contentMatchesMime(HTML, 'text/plain', HTML.length)).toBe(false)
    expect(contentMatchesMime(Buffer.from([0x61, 0x00, 0x62]), 'text/plain', 3)).toBe(false)
    expect(contentMatchesMime(Buffer.from([0xc3, 0x28]), 'text/plain', 2)).toBe(false)
  })

  it('the type allow-list is exact (no svg, html or wildcard matches)', () => {
    expect(isMimeAllowed('application/pdf')).toBe(true)
    for (const m of ['image/svg+xml', 'text/html', 'application/zip', 'application/x-msdownload']) {
      expect(isMimeAllowed(m)).toBe(false)
    }
  })

  it('upload requests are validated (type, size, filename)', () => {
    const ok = {
      patientId: 'p',
      fileName: 'lab.pdf',
      mimeType: 'application/pdf',
      size: 100,
    }
    expect(createUploadIntentSchema.safeParse(ok).success).toBe(true)
    for (const bad of [
      { ...ok, mimeType: 'image/svg+xml' },
      { ...ok, size: 0 },
      { ...ok, size: 50 * 1024 * 1024 },
      { ...ok, fileName: '../../x.pdf' },
      { ...ok, fileName: '' },
      { ...ok, storagePath: 'x' },
    ]) {
      expect(createUploadIntentSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('production configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    CORS_ORIGIN: 'https://app',
  }
  const fatal = (env: Record<string, string>, re: RegExp) =>
    collectEnvProblems(env as NodeJS.ProcessEnv).some((p) => p.fatal && re.test(p.message))

  it('no object storage → fatal (patient files would go to local disk)', () => {
    expect(fatal(base, /S3_ACCESS_KEY_ID/)).toBe(true)
    expect(
      fatal({ ...base, S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b' }, /S3_ACCESS_KEY_ID/)
    ).toBe(false)
  })

  it('an invalid S3_SSE value is fatal', () => {
    expect(fatal({ ...base, S3_SSE: 'off' }, /S3_SSE/)).toBe(true)
  })
})
