/**
 * Object storage for patient files (B3.1). Every read and write of file
 * bytes happens through a short-lived, backend-issued presigned URL; the API
 * itself only issues URLs and inspects objects.
 */
export interface PresignedUpload {
  url: string
  method: 'PUT'
  /** Headers the client must send with the PUT (signed into the URL). */
  headers: Record<string, string>
}

export interface UploadUrlOptions {
  contentType: string
  /** Exact byte length; the signature fails if the body differs. */
  contentLength: number
  expiresIn: number
  /** Public origin of this API, for drivers that serve URLs themselves. */
  baseUrl: string
}

export interface DownloadUrlOptions {
  /** Served Content-Type: the validated type, never the uploader's guess. */
  contentType: string
  expiresIn: number
  baseUrl: string
}

export interface FileStorageDriver {
  readonly kind: 's3' | 'local'
  /** The durable reference stored in PatientFile.storagePath. */
  refFor(key: string): string
  createUploadUrl(key: string, opts: UploadUrlOptions): Promise<PresignedUpload>
  createDownloadUrl(key: string, opts: DownloadUrlOptions): Promise<string>
  /** Size of a stored object, or null when it does not exist. */
  head(key: string): Promise<{ size: number } | null>
  /** The first `bytes` bytes of a stored object. */
  readHead(key: string, bytes: number): Promise<Buffer>
  delete(key: string): Promise<void>
  /** Server-side write — maintenance only (migrating legacy disk files). */
  putObject(key: string, body: Buffer, contentType: string): Promise<void>
}

/**
 * Object keys are opaque: clinic, patient and file IDs only. The original
 * filename (which can carry PHI, e.g. "Jane-Doe-HIV-result.pdf") never
 * appears in a key, a URL, or a log line (F3.3).
 */
export const patientFileKey = (clinicId: string, patientId: string, fileId: string): string =>
  `patient-files/${clinicId}/${patientId}/${fileId}`
