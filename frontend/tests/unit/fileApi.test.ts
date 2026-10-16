/**
 * F3.1 / F3.3 — patient file I/O goes through backend-issued presigned URLs
 * only: the API is asked for a URL, the bytes go straight to that URL with
 * no Authorization header or cookies, and the filename never appears in any
 * request URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import api, { setAccessToken, clearAccessToken } from '@/lib/api'
import {
  uploadPatientFile,
  fetchPatientFileBlob,
  getFileDownloadUrl,
  downloadPatientFile,
  FileTransferError,
} from '@/lib/fileApi'
import { fileUploadProblem, isPreviewable, FILE_SIZE_LIMIT_BYTES } from '@/lib/fileConstants'

const PHI_NAME = 'Quinn Marlowe HIV result.pdf'
const UPLOAD_URL = 'https://bucket.example.test/patient-files/c/p/obj?X-Amz-Signature=abc'
const DOWNLOAD_URL = 'https://bucket.example.test/patient-files/c/p/obj?X-Amz-Signature=def'

const apiCalls: InternalAxiosRequestConfig[] = []
let apiHandler: (c: InternalAxiosRequestConfig) => { status: number; data: unknown }
const adapter: AxiosAdapter = async (config) => {
  apiCalls.push(config)
  const { status, data } = apiHandler(config)
  const response = { status, statusText: String(status), headers: {}, config, data }
  if (status >= 400)
    throw new AxiosError(`status ${status}`, 'ERR_BAD_RESPONSE', config, null, response)
  return response
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  apiCalls.length = 0
  api.defaults.adapter = adapter
  setAccessToken('staff-token')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  clearAccessToken()
  vi.unstubAllGlobals()
})

const pdf = () => new File(['%PDF-1.7 synthetic'], PHI_NAME, { type: 'application/pdf' })

describe('upload', () => {
  it('intent → PUT to the presigned URL (no credentials) → complete', async () => {
    apiHandler = (c) => {
      if (c.url === '/files/uploads') {
        return {
          status: 201,
          data: {
            data: {
              fileId: 'f1',
              uploadUrl: UPLOAD_URL,
              method: 'PUT',
              headers: {
                'Content-Type': 'application/pdf',
                'x-amz-server-side-encryption': 'AES256',
              },
              expiresAt: new Date().toISOString(),
            },
          },
        }
      }
      if (c.url === '/files/f1/complete') return { status: 200, data: { data: { id: 'f1' } } }
      return { status: 404, data: {} }
    }
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))

    const file = pdf()
    await expect(uploadPatientFile(file, { patientId: 'p1', tags: ['lab'] })).resolves.toEqual({
      id: 'f1',
    })

    // The API only sees metadata, in a JSON body — never in the URL.
    expect(apiCalls.map((c) => c.url)).toEqual(['/files/uploads', '/files/f1/complete'])
    expect(JSON.parse(apiCalls[0]!.data as string)).toEqual({
      patientId: 'p1',
      tags: ['lab'],
      fileName: PHI_NAME,
      mimeType: 'application/pdf',
      size: file.size,
    })
    for (const c of apiCalls) expect(c.url).not.toContain('Quinn')

    // The bytes go straight to storage with the signed headers, no auth, no cookies.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(UPLOAD_URL)
    expect(init).toMatchObject({ method: 'PUT', body: file, credentials: 'omit' })
    expect(init!.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'AES256',
    })
    expect(JSON.stringify(init!.headers)).not.toMatch(/authorization/i)
  })

  it('a refused PUT stops before complete and surfaces a transfer error', async () => {
    apiHandler = () => ({
      status: 201,
      data: {
        data: { fileId: 'f1', uploadUrl: UPLOAD_URL, method: 'PUT', headers: {}, expiresAt: '' },
      },
    })
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    await expect(uploadPatientFile(pdf(), { patientId: 'p1' })).rejects.toBeInstanceOf(
      FileTransferError
    )
    expect(apiCalls.map((c) => c.url)).toEqual(['/files/uploads'])
  })
})

describe('download', () => {
  beforeEach(() => {
    apiHandler = (c) =>
      c.url?.includes('/download-url')
        ? {
            status: 200,
            data: {
              data: {
                url: DOWNLOAD_URL,
                expiresAt: '',
                fileName: PHI_NAME,
                mimeType: 'application/pdf',
              },
            },
          }
        : { status: 404, data: {} }
  })

  it('asks the API for a presigned URL, then fetches it without credentials', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF-1.7', { status: 200 }))
    const { blob, grant } = await fetchPatientFileBlob('f1')
    expect(apiCalls[0]!.url).toBe('/files/f1/download-url')
    expect(apiCalls[0]!.method).toBe('get')
    expect(fetchMock).toHaveBeenCalledWith(DOWNLOAD_URL, { credentials: 'omit' })
    expect(blob.type).toBe('application/pdf')
    expect(grant.fileName).toBe(PHI_NAME)
  })

  it('patients use their own scoped endpoint', async () => {
    await getFileDownloadUrl('f9', { asPatient: true, clinicId: 'c1' })
    expect(apiCalls[0]!.url).toBe('/files/patient/me/f9/download-url?clinicId=c1')
  })

  it('an unauthorised file is refused by the API and nothing is fetched', async () => {
    apiHandler = () => ({ status: 403, data: { message: 'Access denied' } })
    await expect(fetchPatientFileBlob('other-clinic-file')).rejects.toMatchObject({
      response: { status: 403 },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an expired / refused presigned URL surfaces as a transfer error', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    await expect(fetchPatientFileBlob('f1')).rejects.toMatchObject({ status: 403 })
  })

  it('the filename is applied locally only (download attribute), never in a URL', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF-1.7', { status: 200 }))
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL: () => 'blob:local', revokeObjectURL: () => undefined })
    const clicks: { href: string; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicks.push({ href: this.getAttribute('href') ?? '', download: this.download })
    })
    await downloadPatientFile('f1', PHI_NAME)
    expect(clicks).toEqual([{ href: 'blob:local', download: PHI_NAME }])
    const urls = [
      ...apiCalls.map((c) => c.url ?? ''),
      ...fetchMock.mock.calls.map((c) => String(c[0])),
    ]
    for (const u of urls) expect(decodeURIComponent(u)).not.toContain('Quinn')
  })
})

describe('client-side upload rules mirror the API', () => {
  it('blocks disallowed types, empty and oversize files', () => {
    expect(fileUploadProblem({ type: 'application/pdf', size: 10 })).toBeNull()
    expect(fileUploadProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/not allowed/)
    expect(fileUploadProblem({ type: 'text/html', size: 10 })).toMatch(/not allowed/)
    expect(fileUploadProblem({ type: 'application/pdf', size: 0 })).toMatch(/empty/)
    expect(fileUploadProblem({ type: 'application/pdf', size: FILE_SIZE_LIMIT_BYTES + 1 })).toMatch(
      /larger/
    )
  })

  it('only images and PDFs are previewable', () => {
    expect(isPreviewable('application/pdf')).toBe(true)
    expect(isPreviewable('image/png')).toBe(true)
    expect(isPreviewable('text/csv')).toBe(false)
    expect(isPreviewable('application/zip')).toBe(false)
  })
})
