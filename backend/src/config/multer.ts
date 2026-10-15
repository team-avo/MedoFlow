import multer from 'multer'
import path from 'path'
import fs from 'fs'
import type { ApiError } from '../types/errors'
import { MIME_WHITELIST, FILE_SIZE_LIMIT_BYTES } from './fileConstants'

export const UPLOAD_BASE = path.resolve(process.cwd(), 'uploads')

export const ensureUploadDir = (clinicId: string, patientId: string): string => {
  const dir = path.join(UPLOAD_BASE, clinicId, patientId)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export const patientFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_SIZE_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = MIME_WHITELIST.some(
      (m) =>
        file.mimetype.toLowerCase() === m ||
        file.mimetype.toLowerCase().startsWith(m.split('/')[0] + '/')
    )
    if (allowed) {
      cb(null, true)
    } else {
      const err = new Error('File type not allowed') as ApiError
      err.statusCode = 400
      cb(err)
    }
  },
})

export const generateStoragePath = (
  clinicId: string,
  patientId: string,
  originalName: string
): { dir: string; filename: string; relativePath: string } => {
  const dir = ensureUploadDir(clinicId, patientId)
  const ext = path.extname(originalName) || ''
  const base = path.basename(originalName, ext)
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
  const filename = `${safe}-${Date.now()}${ext}`
  const relativePath = path.join(clinicId, patientId, filename)
  return { dir, filename, relativePath }
}
