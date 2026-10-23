/**
 * Field-level encryption of clinical free text (B3.2, docs/adr/0002).
 *
 * Values are sealed with AES-256-GCM before they reach Postgres and opened
 * transparently when read back through the app's Prisma client (see the
 * query extension in config/prisma.ts). A database dump, a backup, a
 * replica or an over-privileged SQL session sees only ciphertext.
 *
 * Envelope:  fle:v1:<kid>:<Model.field>:<s|j>:<iv>:<tag>:<ciphertext>   (base64url)
 *   kid          which key sealed it (rotation)
 *   Model.field  authenticated as AAD — a value copied into another column fails
 *   s | j        string column, or JSON column (the JSON is sealed as text and
 *                stored as a JSON string)
 *
 * Values without the `fle:` prefix are legacy plaintext and read as-is until
 * `ops:encrypt-phi` seals them.
 */
import crypto from 'crypto'
import { getKeyring } from '../config/fieldKeys'

export type FieldKind = 's' | 'j'

/** Every encrypted column. A unit test checks each one against the Prisma schema. */
export const ENCRYPTED_FIELDS: Readonly<Record<string, Readonly<Record<string, FieldKind>>>> = {
  VisitRecord: { subjective: 's', objective: 's', assessment: 's', plan: 's', note: 's' },
  VisitNoteVersion: { subjective: 's', objective: 's', assessment: 's', plan: 's' },
  AIScribeSession: { transcript: 's', timeline: 'j', aiDraft: 'j', patientSummary: 'j' },
  ConsultationSession: { transcriptText: 's' },
  FormResponse: { responses: 'j' },
  VoiceCall: { transcript: 'j', summary: 's' },
  RxOrderLine: { rawText: 's' },
  PatientCommerceProfile: {
    shippingName: 's',
    shippingLine1: 's',
    shippingLine2: 's',
    shippingCity: 's',
    shippingPostalCode: 's',
  },
  SiteLead: { name: 's', email: 's', phone: 's', message: 's' },
}

export const ENVELOPE_PREFIX = 'fle:v1:'

export class FieldEncryptionError extends Error {
  statusCode = 500
  code = 'field_encryption_error'
}

export const isSealed = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith(ENVELOPE_PREFIX)

let warnedUnconfigured = false

/** Seals one value. Returns it unchanged when no key is configured (non-production). */
export function sealField(model: string, field: string, kind: FieldKind, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (isSealed(value)) return value
  const ring = getKeyring()
  if (!ring) {
    if (process.env.NODE_ENV === 'production') {
      throw new FieldEncryptionError('Field encryption keys are not loaded')
    }
    if (!warnedUnconfigured) {
      warnedUnconfigured = true
      console.warn('[field-encryption] no keys configured — clinical text is stored unencrypted')
    }
    return value
  }
  const plain = kind === 's' && typeof value === 'string' ? value : JSON.stringify(value)
  const label = `${model}.${field}`
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ring.keys.get(ring.activeKid)!, iv)
  cipher.setAAD(Buffer.from(`${ring.activeKid}|${label}|${kind}`))
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    'fle',
    'v1',
    ring.activeKid,
    label,
    kind,
    iv.toString('base64url'),
    tag.toString('base64url'),
    data.toString('base64url'),
  ].join(':')
}

export interface ParsedEnvelope {
  kid: string
  label: string
  kind: FieldKind
}

export function parseEnvelope(
  sealed: string
): ParsedEnvelope & { iv: Buffer; tag: Buffer; data: Buffer } {
  const parts = sealed.split(':')
  const [p, v, kid, label, kind, iv, tag, data] = parts
  if (
    parts.length !== 8 ||
    p !== 'fle' ||
    v !== 'v1' ||
    !kid ||
    !label ||
    (kind !== 's' && kind !== 'j')
  ) {
    throw new FieldEncryptionError('Unrecognised encrypted field format')
  }
  return {
    kid,
    label,
    kind,
    iv: Buffer.from(iv!, 'base64url'),
    tag: Buffer.from(tag!, 'base64url'),
    data: Buffer.from(data!, 'base64url'),
  }
}

/**
 * Opens one sealed value. `expectField`, when given, must match the field
 * the envelope was sealed for — a value moved to another column is refused.
 */
export function openField(sealed: string, expectField?: string): unknown {
  const env = parseEnvelope(sealed)
  if (expectField !== undefined && env.label.split('.')[1] !== expectField) {
    throw new FieldEncryptionError('Encrypted value does not belong to this field')
  }
  const key = getKeyring()?.keys.get(env.kid)
  if (!key) throw new FieldEncryptionError(`Field encryption key "${env.kid}" is not loaded`)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, env.iv)
  decipher.setAAD(Buffer.from(`${env.kid}|${env.label}|${env.kind}`))
  decipher.setAuthTag(env.tag)
  let plain: string
  try {
    plain = Buffer.concat([decipher.update(env.data), decipher.final()]).toString('utf8')
  } catch {
    throw new FieldEncryptionError('Encrypted field failed integrity check')
  }
  return env.kind === 'j' ? (JSON.parse(plain) as unknown) : plain
}

// ── Prisma integration ─────────────────────────────────────────────────────

const WRITE_OPS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
])

/** Prisma's JsonNull/DbNull/AnyNull sentinels are class instances, not plain data. */
const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

function sealData(
  model: string,
  fields: Readonly<Record<string, FieldKind>>,
  data: unknown
): unknown {
  if (Array.isArray(data)) return data.map((d) => sealData(model, fields, d))
  if (!isPlainObject(data)) return data
  let out: Record<string, unknown> | null = null
  for (const [field, kind] of Object.entries(fields)) {
    if (!(field in data)) continue
    const value = data[field]
    // Prisma null sentinels (JsonNull/DbNull) and plain null pass through.
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'object' && !isPlainObject(value) && !Array.isArray(value))
    ) {
      continue
    }
    out ??= { ...data }
    // String columns may be written as { set: value }.
    if (kind === 's' && isPlainObject(value) && 'set' in value) {
      out[field] = { ...value, set: sealField(model, field, kind, value.set) }
    } else {
      out[field] = sealField(model, field, kind, value)
    }
  }
  return out ?? data
}

/** Seals encrypted fields in a write's data before it is sent to Postgres. */
export function sealWriteArgs(model: string, operation: string, args: unknown): unknown {
  const fields = ENCRYPTED_FIELDS[model]
  if (!fields || !WRITE_OPS.has(operation) || !isPlainObject(args)) return args
  if (operation === 'upsert') {
    return {
      ...args,
      create: sealData(model, fields, args.create),
      update: sealData(model, fields, args.update),
    }
  }
  return 'data' in args ? { ...args, data: sealData(model, fields, args.data) } : args
}

const isNullCheck = (v: unknown): boolean => {
  if (v === null) return true
  if (typeof v === 'object' && !isPlainObject(v) && !Array.isArray(v)) return true // Prisma null sentinel
  if (isPlainObject(v)) {
    const entries = Object.entries(v)
    return (
      entries.length > 0 &&
      entries.every(([k, x]) => (k === 'not' || k === 'equals') && isNullCheck(x))
    )
  }
  return false
}

export class EncryptedFieldFilterError extends Error {
  statusCode = 500
  code = 'encrypted_field_filter'
  constructor(model: string, field: string) {
    super(`${model}.${field} is encrypted and cannot be filtered on (only null checks are allowed)`)
  }
}

/**
 * Ciphertext is randomised, so a filter on an encrypted column would
 * silently match nothing. Refuse it loudly instead. Null checks still work.
 */
export function assertNoEncryptedFilter(model: string, args: unknown): void {
  const fields = ENCRYPTED_FIELDS[model]
  if (!fields || !isPlainObject(args)) return
  const visit = (where: unknown): void => {
    if (Array.isArray(where)) return where.forEach(visit)
    if (!isPlainObject(where)) return
    for (const [k, v] of Object.entries(where)) {
      if (k === 'AND' || k === 'OR' || k === 'NOT') visit(v)
      else if (k in fields && !isNullCheck(v)) throw new EncryptedFieldFilterError(model, k)
    }
  }
  visit(args.where)
}

/**
 * Opens every sealed value anywhere in a query result, including relations
 * pulled in by include/select (currentVersion, versions, aiScribeSession…).
 * Maintenance code that needs values as stored uses findManyAsStored()
 * (config/prisma.ts), which bypasses this.
 */
export function openResult(result: unknown): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const items = node as unknown[]
      for (let i = 0; i < items.length; i++) {
        const v = items[i]
        if (isSealed(v)) items[i] = openField(v)
        else if (v !== null && typeof v === 'object') walk(v)
      }
      return node
    }
    if (isPlainObject(node)) {
      for (const [k, v] of Object.entries(node)) {
        if (isSealed(v)) node[k] = openField(v, k)
        else if (v !== null && typeof v === 'object') walk(v)
      }
    }
    return node
  }
  return walk(result)
}
