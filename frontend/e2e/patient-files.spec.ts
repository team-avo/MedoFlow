/**
 * F3.1 / F3.3 — patient files in the browser:
 *  - staff upload through a backend-issued presigned URL (bytes go straight
 *    to storage, no Authorization header, no cookies), then the file lists;
 *  - disallowed / oversize files are blocked before any request;
 *  - download and preview fetch a fresh presigned URL; the filename is
 *    applied locally (download attribute) and never appears in any URL;
 *  - a file outside the user's authorisation is refused with a clear message;
 *  - patients download their own files from the portal.
 */
import { expect, test, type Page } from '@playwright/test'
import { installMockApi } from './mockApi'
import { expectNoSeriousA11yViolations } from './helpers'
import { installSchedulingMock, PATIENT, utcAt } from './schedulingMock'
import { installFilesMock, PNG_BYTES, BUCKET_ORIGIN, type FilesState } from './filesMock'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

/** The filename is PHI: it carries the (synthetic) patient's name. */
const PHI_FILE = `${PATIENT.name.replace(/ /g, '-')}-lab-results.png`

function recordUrls(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (r) => urls.push(r.url()))
  page.on('framenavigated', (f) => urls.push(f.url()))
  return urls
}

function expectNoPhiOrFilenameInUrls(urls: string[]) {
  const probes = [
    PHI_FILE,
    PHI_FILE.replace(/\.png$/, ''),
    'lab-results',
    PATIENT.name,
    ...PATIENT.name.split(' '),
    PATIENT.email,
  ]
  const decode = (u: string) => {
    try {
      return decodeURIComponent(u)
    } catch {
      return u
    }
  }
  expect(urls.length).toBeGreaterThan(0)
  const leaks = urls.filter((u) =>
    probes.some((p) => decode(u).toLowerCase().includes(p.toLowerCase()))
  )
  expect(leaks).toEqual([])
}

function expectNoCredentialsToBucket(files: FilesState) {
  expect(files.bucketRequests.length).toBeGreaterThan(0)
  for (const r of files.bucketRequests) {
    expect(r.headers['authorization']).toBeUndefined()
    expect(r.headers['cookie']).toBeUndefined()
    expect(r.url.startsWith(BUCKET_ORIGIN)).toBe(true)
  }
}

async function openStaffFilesTab(page: Page) {
  await page.goto('/dashboard/provider/appointments/appt-1')
  await page.getByRole('button', { name: 'Full Clinical Record' }).click()
  await page.getByRole('tab', { name: /Files/ }).click()
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
}

test('F3.1 staff upload → list → download → preview through presigned URLs only', async ({
  page,
}) => {
  const urls = recordUrls(page)
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })
  await installSchedulingMock(page, {
    appointments: [
      { id: 'appt-1', startTime: utcAt(-1, '09:00').toISOString(), status: 'COMPLETED' },
    ],
  })
  const files = await installFilesMock(page)

  await openStaffFilesTab(page)
  await expect(page.getByText('No files')).toBeVisible()

  // Upload: intent → PUT to the bucket → complete.
  await page.getByLabel('Upload file').setInputFiles({
    name: PHI_FILE,
    mimeType: 'image/png',
    buffer: PNG_BYTES,
  })
  await expect(page.getByText('File uploaded')).toBeVisible()
  await expect(page.getByText(PHI_FILE)).toBeVisible()
  expect(files.apiCalls).toEqual(
    expect.arrayContaining(['POST /files/uploads', 'POST /files/file-1/complete'])
  )
  expect(files.files[0]!.bytes!.equals(PNG_BYTES)).toBe(true)

  // Download: the browser saves the file under its real name, set locally.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  expect((await download).suggestedFilename()).toBe(PHI_FILE)

  // Preview: a fresh presigned GET, shown from a local object URL.
  await page.getByRole('button', { name: 'Preview' }).click()
  const dialog = page.getByRole('dialog', { name: 'File preview' })
  await expect(dialog.getByRole('img', { name: 'File preview' })).toBeVisible()
  await expect(dialog.getByRole('img')).toHaveAttribute('src', /^blob:/)
  await expectNoSeriousA11yViolations(page, '[role="dialog"][aria-label="File preview"]')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  expect(files.apiCalls.filter((c) => c.endsWith('/download-url'))).toHaveLength(2)
  expectNoCredentialsToBucket(files)
  expectNoPhiOrFilenameInUrls(urls)
})

test('F3.1 disallowed and oversize files are blocked before any request', async ({ page }) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })
  await installSchedulingMock(page, {
    appointments: [
      { id: 'appt-1', startTime: utcAt(-1, '09:00').toISOString(), status: 'COMPLETED' },
    ],
  })
  const files = await installFilesMock(page)
  await openStaffFilesTab(page)

  await page.getByLabel('Upload file').setInputFiles({
    name: 'payload.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
  })
  await expect(page.getByText('This file type is not allowed', { exact: false })).toBeVisible()

  await page.getByLabel('Upload file').setInputFiles({
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25),
  })
  await expect(page.getByText('The file is larger than 10 MB.')).toBeVisible()
  expect(files.apiCalls.filter((c) => c.startsWith('POST'))).toEqual([])
  expect(files.bucketRequests).toEqual([])
})

test('F3.1 a file outside the user’s authorisation is refused with a clear message', async ({
  page,
}) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })
  await installSchedulingMock(page, {
    appointments: [
      { id: 'appt-1', startTime: utcAt(-1, '09:00').toISOString(), status: 'COMPLETED' },
    ],
  })
  const files = await installFilesMock(page, [
    {
      id: 'file-x',
      originalName: 'other-clinic.pdf',
      mimeType: 'application/pdf',
      size: 10,
      tags: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      status: 'AVAILABLE',
      forbidden: true,
    },
  ])
  await openStaffFilesTab(page)
  await page.getByRole('button', { name: 'Download' }).click()
  await expect(page.getByText('You do not have access to this file.')).toBeVisible()
  // No presigned URL was issued, so nothing was fetched from storage.
  expect(files.bucketRequests).toEqual([])
})

test('F3.1 a patient downloads their own file from the portal', async ({ page }) => {
  const urls = recordUrls(page)
  await installMockApi(page, { role: 'PATIENT', signedIn: true })
  await installSchedulingMock(page, {
    appointments: [
      { id: 'appt-1', startTime: utcAt(-1, '09:00').toISOString(), status: 'COMPLETED' },
    ],
  })
  const files = await installFilesMock(page, [
    {
      id: 'file-1',
      originalName: PHI_FILE,
      mimeType: 'image/png',
      size: PNG_BYTES.length,
      tags: ['lab'],
      createdAt: '2026-10-01T10:00:00.000Z',
      status: 'AVAILABLE',
      bytes: PNG_BYTES,
    },
  ])

  await page.goto('/account/appointments/appt-1')
  await expect(page.getByText(PHI_FILE)).toBeVisible()
  await expect(page.getByLabel('Upload file')).toHaveCount(0)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  expect((await download).suggestedFilename()).toBe(PHI_FILE)
  expect(files.apiCalls).toContain('GET /files/patient/me/file-1/download-url')
  expectNoCredentialsToBucket(files)
  expectNoPhiOrFilenameInUrls(urls)
})
