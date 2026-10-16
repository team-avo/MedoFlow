/**
 * Stateful stand-in for the patient-file API (B3.1) and the object store
 * behind it. The API issues presigned URLs on a separate "bucket" origin;
 * the bucket accepts a PUT/GET only for a URL it issued, and records the
 * headers it received so specs can prove no credentials reach storage.
 * Synthetic data only.
 */
import type { Page, Route } from '@playwright/test'
import { corsHeaders, fail, ok } from './mockApi'

export const BUCKET_ORIGIN = 'http://127.0.0.1:3998'

/** A 1×1 PNG. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

export interface MockFile {
  id: string
  originalName: string
  mimeType: string
  size: number
  tags: string[] | null
  createdAt: string
  status: 'PENDING' | 'AVAILABLE'
  forbidden?: boolean
  bytes?: Buffer
}

export interface FilesState {
  files: MockFile[]
  /** Headers each bucket request arrived with. */
  bucketRequests: { method: string; url: string; headers: Record<string, string> }[]
  apiCalls: string[]
}

const ALLOWED = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]

const view = (f: MockFile) => ({
  id: f.id,
  originalName: f.originalName,
  mimeType: f.mimeType,
  size: f.size,
  tags: f.tags,
  createdAt: f.createdAt,
  uploadedBy: { id: 'user-e2e-admin', name: 'Synthetic Admin' },
})

export async function installFilesMock(page: Page, seed: MockFile[] = []): Promise<FilesState> {
  const state: FilesState = { files: [...seed], bucketRequests: [], apiCalls: [] }
  let n = 0
  const tokens = new Map<string, { fileId: string; op: 'put' | 'get' }>()
  const issue = (fileId: string, op: 'put' | 'get') => {
    const token = `tok-${op}-${++n}`
    tokens.set(token, { fileId, op })
    return `${BUCKET_ORIGIN}/bucket/${token}?X-Amz-Expires=300&X-Amz-Signature=synthetic`
  }

  // The object store: answers only URLs it issued; no auth, no cookies needed.
  await page.route(`${BUCKET_ORIGIN}/**`, async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: bucketCors(route) })
    state.bucketRequests.push({ method: req.method(), url: req.url(), headers: req.headers() })
    const token = new URL(req.url()).pathname.split('/').pop()!
    const grant = tokens.get(token)
    const file = grant && state.files.find((f) => f.id === grant.fileId)
    if (!grant || !file) return route.fulfill({ status: 403, headers: bucketCors(route) })
    if (req.method() === 'PUT' && grant.op === 'put') {
      file.bytes = req.postDataBuffer() ?? Buffer.alloc(0)
      return route.fulfill({ status: 200, headers: bucketCors(route) })
    }
    if (req.method() === 'GET' && grant.op === 'get') {
      return route.fulfill({
        status: 200,
        headers: {
          ...bucketCors(route),
          'content-type': file.mimeType,
          'content-disposition': 'attachment',
        },
        body: file.bytes ?? PNG_BYTES,
      })
    }
    return route.fulfill({ status: 403, headers: bucketCors(route) })
  })

  // The API (registered after installMockApi/installSchedulingMock, so it wins for /files).
  await page.route('http://127.0.0.1:3999/api/v1/files/**', async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: corsHeaders(route) })
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    state.apiCalls.push(`${req.method()} ${path}`)
    if (!req.headers()['authorization'])
      return fail(route, 401, 'unauthorized', 'Not authenticated')
    let m: RegExpMatchArray | null

    if (req.method() === 'POST' && path === '/files/uploads') {
      const body = req.postDataJSON() as { fileName: string; mimeType: string; size: number }
      if (!ALLOWED.includes(body.mimeType))
        return fail(route, 400, 'file_type_not_allowed', 'File type not allowed')
      const file: MockFile = {
        id: `file-${state.files.length + 1}`,
        originalName: body.fileName,
        mimeType: body.mimeType,
        size: body.size,
        tags: null,
        createdAt: new Date().toISOString(),
        status: 'PENDING',
      }
      state.files.push(file)
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: corsHeaders(route),
        body: JSON.stringify({
          success: true,
          data: {
            fileId: file.id,
            uploadUrl: issue(file.id, 'put'),
            method: 'PUT',
            headers: { 'Content-Type': body.mimeType },
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          },
        }),
      })
    }
    if (req.method() === 'POST' && (m = path.match(/^\/files\/([^/]+)\/complete$/))) {
      const file = state.files.find((f) => f.id === m![1])
      if (!file?.bytes || file.bytes.length !== file.size) {
        return fail(route, 409, 'upload_incomplete', 'The file has not been uploaded yet')
      }
      file.status = 'AVAILABLE'
      return ok(route, { id: file.id })
    }
    if (
      req.method() === 'GET' &&
      (path === '/files/patient/me' || /^\/files\/patient\/[^/]+$/.test(path))
    ) {
      return ok(route, { files: state.files.filter((f) => f.status === 'AVAILABLE').map(view) })
    }
    if (
      req.method() === 'GET' &&
      (m = path.match(/^\/files\/(?:patient\/me\/)?([^/]+)\/download-url$/))
    ) {
      const file = state.files.find((f) => f.id === m![1] && f.status === 'AVAILABLE')
      if (!file) return fail(route, 404, 'not_found', 'File not found')
      if (file.forbidden) return fail(route, 403, 'forbidden', 'Access denied')
      return ok(route, {
        url: issue(file.id, 'get'),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        fileName: file.originalName,
        mimeType: file.mimeType,
      })
    }
    return fail(route, 404, 'not_found', 'Not found')
  })
  return state
}

function bucketCors(route: Route) {
  const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1:4310'
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
  }
}
