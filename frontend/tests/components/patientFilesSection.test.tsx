/**
 * F3.1 / F3.3 — PatientFilesSection: invalid files are blocked before any
 * request, uploads and downloads go through the presigned-URL helpers, a
 * refused (unauthorised) download shows a clear message, and no toast ever
 * carries the filename.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'

const PHI_NAME = 'Quinn-Marlowe-lab-results.pdf'
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), show: vi.fn() }
vi.mock('@/hooks/useAppToast', () => ({ useAppToast: () => toast }))

const fileApi = vi.hoisted(() => ({
  getPatientFiles: vi.fn(),
  getMyFiles: vi.fn(),
  uploadPatientFile: vi.fn(),
  deletePatientFile: vi.fn(),
  downloadPatientFile: vi.fn(),
  fetchPatientFileBlob: vi.fn(),
}))
vi.mock('@/lib/fileApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/fileApi')>()),
  ...fileApi,
}))

import { PatientFilesSection } from '@/components/PatientFilesSection'

const FILE = {
  id: 'f1',
  originalName: PHI_NAME,
  mimeType: 'application/pdf',
  size: 2048,
  tags: ['lab'],
  createdAt: '2026-10-01T10:00:00.000Z',
  uploadedBy: { id: 'u1', name: 'Synthetic Staff' },
}

const httpError = (status: number) => {
  const config = { headers: {} } as InternalAxiosRequestConfig
  return new AxiosError('x', 'ERR', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { message: 'Access denied' },
  })
}

function renderSection(props: Partial<React.ComponentProps<typeof PatientFilesSection>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PatientFilesSection patientId="p1" clinicId="c1" {...props} />
    </QueryClientProvider>
  )
}

const toastText = () =>
  [...toast.success.mock.calls, ...toast.error.mock.calls].map((c) => String(c[0])).join(' | ')

beforeEach(() => {
  vi.clearAllMocks()
  fileApi.getPatientFiles.mockResolvedValue([FILE])
  fileApi.getMyFiles.mockResolvedValue([FILE])
})

describe('PatientFilesSection', () => {
  it('lists files with an accept-restricted upload input', async () => {
    renderSection()
    expect(await screen.findByText(PHI_NAME)).toBeInTheDocument()
    const input = screen.getByLabelText('Upload file') as HTMLInputElement
    expect(input.accept).toContain('application/pdf')
    expect(input.accept).not.toContain('svg')
  })

  it('blocks a disallowed type and an oversize file before any request', async () => {
    renderSection()
    const input = (await screen.findByLabelText('Upload file')) as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['<svg/>'], 'Quinn.svg', { type: 'image/svg+xml' })] },
    })
    const big = new File(['x'], 'Quinn-big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [big] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
    expect(fileApi.uploadPatientFile).not.toHaveBeenCalled()
    expect(toastText()).not.toContain('Quinn')
  })

  it('uploads a valid file through the presigned flow', async () => {
    fileApi.uploadPatientFile.mockResolvedValue({ id: 'f2' })
    renderSection()
    const input = (await screen.findByLabelText('Upload file')) as HTMLInputElement
    const file = new File(['%PDF-1.7'], PHI_NAME, { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('File uploaded'))
    expect(fileApi.uploadPatientFile).toHaveBeenCalledWith(file, { patientId: 'p1' })
    expect(toastText()).not.toContain('Quinn')
  })

  it('a refused download (outside the user’s authorisation) shows a clear message', async () => {
    fileApi.downloadPatientFile.mockRejectedValue(httpError(403))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('You do not have access to this file.')
    )
    expect(fileApi.downloadPatientFile).toHaveBeenCalledWith('f1', PHI_NAME, {
      asPatient: false,
      clinicId: 'c1',
    })
  })

  it('patients download through their own scope and cannot upload', async () => {
    fileApi.downloadPatientFile.mockResolvedValue(undefined)
    renderSection({ asPatient: true, canUpload: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => expect(fileApi.downloadPatientFile).toHaveBeenCalled())
    expect(fileApi.downloadPatientFile.mock.calls[0]![2]).toEqual({
      asPatient: true,
      clinicId: 'c1',
    })
    expect(screen.queryByLabelText('Upload file')).not.toBeInTheDocument()
  })

  it('preview opens a local object URL from a fresh presigned fetch; Escape closes it', async () => {
    Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() })
    fileApi.fetchPatientFileBlob.mockResolvedValue({
      blob: new Blob(['%PDF'], { type: 'application/pdf' }),
      grant: {
        url: 'https://bucket.example.test/x',
        fileName: PHI_NAME,
        mimeType: 'application/pdf',
        expiresAt: '',
      },
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    const dialog = await screen.findByRole('dialog', { name: 'File preview' })
    expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe('blob:preview')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('a failed preview shows an error instead of failing silently', async () => {
    fileApi.fetchPatientFileBlob.mockRejectedValue(httpError(404))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This file is no longer available.')
    )
  })
})
