import api from './api'

/**
 * Patient files (B3.1 / F3.1). File bytes never travel through an
 * authenticated API call: the API issues a short-lived presigned URL and the
 * browser PUTs / GETs the object directly. The presigned request carries no
 * Authorization header or cookies — the signature in the URL is the grant.
 *
 * F3.3: the original filename is only ever used locally (list label, the
 * download's `download` attribute). It never appears in a URL, a query
 * string, a toast, or a log line.
 */

export interface PatientFile {
  id: string
  originalName: string
  mimeType: string
  size: number
  tags: string[] | null
  createdAt: string
  visitRecordId?: string | null
  uploadedBy: { id: string; name: string }
}

export interface UploadPatientFilePayload {
  patientId: string
  visitRecordId?: string
  tags?: string[]
}

export interface UploadIntent {
  fileId: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

export interface DownloadGrant {
  url: string
  expiresAt: string
  fileName: string
  mimeType: string
}

/** Thrown when the presigned transfer itself fails (bucket refused / network). */
export class FileTransferError extends Error {
  constructor(public readonly status: number) {
    super('The file transfer did not complete. Please try again.')
    this.name = 'FileTransferError'
  }
}

/**
 * Upload: request a presigned URL → PUT the bytes straight to storage →
 * ask the API to verify the stored object (size + content type).
 */
export const uploadPatientFile = async (
  file: File,
  payload: UploadPatientFilePayload
): Promise<{ id: string }> => {
  const { data: intentRes } = await api.post<{ success: boolean; data: UploadIntent }>(
    '/files/uploads',
    {
      patientId: payload.patientId,
      ...(payload.visitRecordId && { visitRecordId: payload.visitRecordId }),
      ...(payload.tags && { tags: payload.tags }),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    }
  )
  const intent = intentRes.data

  let put: Response
  try {
    put = await fetch(intent.uploadUrl, {
      method: intent.method,
      headers: intent.headers,
      body: file,
      credentials: 'omit',
    })
  } catch {
    throw new FileTransferError(0)
  }
  if (!put.ok) throw new FileTransferError(put.status)

  const { data } = await api.post<{ success: boolean; data: { id: string } }>(
    `/files/${intent.fileId}/complete`
  )
  return data.data
}

export const getPatientFiles = async (patientId: string): Promise<PatientFile[]> => {
  const { data } = await api.get<{
    success: boolean
    data: { files: PatientFile[] }
  }>(`/files/patient/${patientId}`)
  return data.data.files
}

/** Patient fetches their own files via /patient/me (membership-scoped) */
export const getMyFiles = async (clinicId?: string): Promise<PatientFile[]> => {
  const params = clinicId ? `?clinicId=${clinicId}` : ''
  const { data } = await api.get<{
    success: boolean
    data: { files: PatientFile[] }
  }>(`/files/patient/me${params}`)
  return data.data.files
}

export const deletePatientFile = async (fileId: string): Promise<void> => {
  await api.delete(`/files/${fileId}`)
}

/** A short-lived presigned download URL (staff, or the patient for their own file). */
export const getFileDownloadUrl = async (
  fileId: string,
  opts: { asPatient?: boolean; clinicId?: string } = {}
): Promise<DownloadGrant> => {
  const path = opts.asPatient
    ? `/files/patient/me/${fileId}/download-url${opts.clinicId ? `?clinicId=${opts.clinicId}` : ''}`
    : `/files/${fileId}/download-url`
  const { data } = await api.get<{ success: boolean; data: DownloadGrant }>(path)
  return data.data
}

/** Fetches a file's bytes through a fresh presigned URL, as a typed Blob. */
export const fetchPatientFileBlob = async (
  fileId: string,
  opts: { asPatient?: boolean; clinicId?: string } = {}
): Promise<{ blob: Blob; grant: DownloadGrant }> => {
  const grant = await getFileDownloadUrl(fileId, opts)
  let res: Response
  try {
    res = await fetch(grant.url, { credentials: 'omit' })
  } catch {
    throw new FileTransferError(0)
  }
  if (!res.ok) throw new FileTransferError(res.status)
  const bytes = await res.blob()
  return { blob: new Blob([bytes], { type: grant.mimeType }), grant }
}

/** Downloads a file; the filename is applied locally, never sent anywhere. */
export const downloadPatientFile = async (
  fileId: string,
  fileName: string,
  opts: { asPatient?: boolean; clinicId?: string } = {}
): Promise<void> => {
  const { blob } = await fetchPatientFileBlob(fileId, opts)
  const href = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = href
    a.download = fileName
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(href), 0)
  }
}
