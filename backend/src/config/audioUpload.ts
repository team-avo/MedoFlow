import multer from 'multer'
import type { ApiError } from '../types/errors'

export const AUDIO_SIZE_LIMIT = 50 * 1024 * 1024 // 50MB for audio

export const AUDIO_SIZE_LIMIT_MB = 50

const AUDIO_MIME = [
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/wav',
  'audio/ogg',
]

/**
 * Browsers type a picked file by its extension, so a .webm recording chosen
 * from disk arrives as "video/webm" even though it holds only audio (it is
 * what browser recorders save). Treat it as the audio it is.
 */
export function normalizeAudioMime(mimeType: string): string {
  const m = mimeType.toLowerCase()
  return m === 'video/webm' ? 'audio/webm' : m
}

export const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_SIZE_LIMIT },
  fileFilter: (_req, file, cb) => {
    file.mimetype = normalizeAudioMime(file.mimetype)
    const allowed = AUDIO_MIME.some(
      (m) => file.mimetype.toLowerCase() === m || file.mimetype.toLowerCase().startsWith('audio/')
    )
    if (allowed) {
      cb(null, true)
    } else {
      const err = new Error('Audio file type not allowed') as ApiError
      err.statusCode = 400
      cb(err)
    }
  },
})
