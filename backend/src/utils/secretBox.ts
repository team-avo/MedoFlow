/**
 * AES-256-GCM encryption for small secrets stored in the database (MFA TOTP
 * secrets). Key: MFA_ENCRYPTION_KEY, 32 bytes as 64 hex characters
 * (`openssl rand -hex 32`). Ciphertext format: v1:<iv b64>:<tag b64>:<data b64>.
 */
import crypto from 'crypto'

export class EncryptionKeyMissingError extends Error {
  statusCode = 503
  code = 'mfa_not_configured'
  constructor() {
    super('MFA is not configured on this server (MFA_ENCRYPTION_KEY is not set)')
  }
}

function key(): Buffer {
  const hex = process.env.MFA_ENCRYPTION_KEY
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) throw new EncryptionKeyMissingError()
  return Buffer.from(hex, 'hex')
}

export function isSecretBoxConfigured(): boolean {
  try {
    key()
    return true
  } catch {
    return false
  }
}

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`
}

export function openSecret(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(':')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised sealed secret format')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8'
  )
}
