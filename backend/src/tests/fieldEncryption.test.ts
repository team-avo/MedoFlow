/**
 * B3.2 — field-level encryption: AES-256-GCM round trip, tamper and
 * column-swap detection, legacy plaintext, JSON columns, key rotation, KMS
 * unwrap, and the Prisma integration helpers.
 */
import crypto from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  ENCRYPTED_FIELDS,
  sealField,
  openField,
  isSealed,
  parseEnvelope,
  sealWriteArgs,
  openResult,
  assertNoEncryptedFilter,
} from '../utils/fieldCrypto'
import {
  loadEnvKeyring,
  loadKmsKeyring,
  initFieldEncryption,
  resetFieldKeysForTests,
  fieldEncryptionConfigProblem,
  parseKeyList,
  KMS_ENCRYPTION_CONTEXT_PURPOSE,
} from '../config/fieldKeys'
import { collectEnvProblems } from '../config/envValidation'

const hex = () => crypto.randomBytes(32).toString('hex')
const K1 = hex()
const K2 = hex()

const useKeys = (keys: string, active?: string) => {
  vi.stubEnv('FIELD_ENCRYPTION_PROVIDER', 'env')
  vi.stubEnv('FIELD_ENCRYPTION_KEYS', keys)
  vi.stubEnv('FIELD_ENCRYPTION_ACTIVE_KID', active ?? '')
  resetFieldKeysForTests()
}

beforeEach(() => useKeys(`k1:${K1}`, 'k1'))
afterEach(() => {
  vi.unstubAllEnvs()
  resetFieldKeysForTests()
})

describe('sealing and opening', () => {
  it('round-trips a string; ciphertext is randomised and carries no plaintext', () => {
    const note = 'Synthetic SOAP: patient reports knee pain'
    const a = sealField('VisitRecord', 'subjective', 's', note) as string
    const b = sealField('VisitRecord', 'subjective', 's', note) as string
    expect(isSealed(a)).toBe(true)
    expect(a).not.toBe(b)
    expect(a).not.toContain('knee')
    expect(openField(a, 'subjective')).toBe(note)
    expect(parseEnvelope(a)).toMatchObject({
      kid: 'k1',
      label: 'VisitRecord.subjective',
      kind: 's',
    })
  })

  it('round-trips JSON (intake answers, AI draft)', () => {
    const answers = { reason: 'Synthetic', age: 40, consent: true, list: [1, 2] }
    const sealed = sealField('FormResponse', 'responses', 'j', answers) as string
    expect(typeof sealed).toBe('string')
    expect(openField(sealed, 'responses')).toEqual(answers)
  })

  it('detects tampering (GCM tag)', () => {
    const sealed = sealField('VisitRecord', 'plan', 's', 'Synthetic plan') as string
    const parts = sealed.split(':')
    const data = Buffer.from(parts[7]!, 'base64url')
    data[0] = data[0]! ^ 0xff
    parts[7] = data.toString('base64url')
    expect(() => openField(parts.join(':'), 'plan')).toThrow(/integrity/)
  })

  it('refuses a value copied into another column (label is authenticated)', () => {
    const sealed = sealField('VisitRecord', 'plan', 's', 'Synthetic plan') as string
    expect(() => openField(sealed, 'subjective')).toThrow(/does not belong/)
    // Rewriting the label to match breaks the authentication instead.
    const forged = sealed.replace('VisitRecord.plan', 'VisitRecord.subjective')
    expect(() => openField(forged, 'subjective')).toThrow(/integrity/)
  })

  it('fails with the wrong key', () => {
    const sealed = sealField('VisitRecord', 'plan', 's', 'Synthetic plan') as string
    useKeys(`k1:${K2}`, 'k1')
    expect(() => openField(sealed, 'plan')).toThrow(/integrity/)
  })

  it('passes null, undefined and already-sealed values through', () => {
    expect(sealField('VisitRecord', 'plan', 's', null)).toBeNull()
    expect(sealField('VisitRecord', 'plan', 's', undefined)).toBeUndefined()
    const sealed = sealField('VisitRecord', 'plan', 's', 'x')
    expect(sealField('VisitRecord', 'plan', 's', sealed)).toBe(sealed)
  })

  it('rotation: old values stay readable, new values use the active key', () => {
    const old = sealField('VisitRecord', 'note', 's', 'Synthetic old') as string
    useKeys(`k1:${K1},k2:${K2}`, 'k2')
    expect(openField(old, 'note')).toBe('Synthetic old')
    const fresh = sealField('VisitRecord', 'note', 's', 'Synthetic new') as string
    expect(parseEnvelope(fresh).kid).toBe('k2')
  })

  it('without keys: plaintext outside production, refused in production', () => {
    useKeys('')
    expect(sealField('VisitRecord', 'plan', 's', 'x')).toBe('x')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => sealField('VisitRecord', 'plan', 's', 'x')).toThrow(/not loaded/)
  })
})

describe('Prisma integration helpers', () => {
  it('every registered field exists in the schema with the declared kind', () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]))
    for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
      const m = models.get(model)
      expect(m, model).toBeDefined()
      for (const [field, kind] of Object.entries(fields)) {
        const f = m!.fields.find((x) => x.name === field)
        expect(f, `${model}.${field}`).toBeDefined()
        expect(f!.type, `${model}.${field}`).toBe(kind === 's' ? 'String' : 'Json')
      }
    }
  })

  it('seals create / update / upsert / createMany data, leaves other fields alone', () => {
    const c = sealWriteArgs('VisitRecord', 'create', {
      data: { clinicId: 'c', subjective: 'Synthetic S', plan: null },
    }) as { data: Record<string, unknown> }
    expect(isSealed(c.data.subjective)).toBe(true)
    expect(c.data.clinicId).toBe('c')
    expect(c.data.plan).toBeNull()

    const u = sealWriteArgs('VisitRecord', 'update', {
      where: { id: 'v' },
      data: { note: { set: 'Synthetic N' } },
    }) as { data: { note: { set: unknown } } }
    expect(isSealed(u.data.note.set)).toBe(true)

    const up = sealWriteArgs('AIScribeSession', 'upsert', {
      where: { id: 's' },
      create: { aiDraft: { subjective: 'x' } },
      update: { transcript: 'Synthetic T' },
    }) as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(isSealed(up.create.aiDraft)).toBe(true)
    expect(isSealed(up.update.transcript)).toBe(true)

    const many = sealWriteArgs('FormResponse', 'createMany', {
      data: [{ responses: { a: 1 } }, { responses: { b: 2 } }],
    }) as { data: Record<string, unknown>[] }
    expect(many.data.every((d) => isSealed(d.responses))).toBe(true)

    // Prisma.JsonNull is a sentinel, not data.
    const jn = sealWriteArgs('AIScribeSession', 'update', {
      data: { patientSummary: Prisma.JsonNull },
    }) as { data: Record<string, unknown> }
    expect(jn.data.patientSummary).toBe(Prisma.JsonNull)

    // Models without encrypted fields and reads are untouched.
    const args = { data: { name: 'x' } }
    expect(sealWriteArgs('Service', 'create', args)).toBe(args)
  })

  it('opens sealed values anywhere in a result, including nested relations', () => {
    const s = (model: string, field: string, kind: 's' | 'j', v: unknown) =>
      sealField(model, field, kind, v)
    const result = [
      {
        id: 'v1',
        subjective: s('VisitRecord', 'subjective', 's', 'Synthetic S'),
        createdAt: new Date(0),
        currentVersion: { plan: s('VisitNoteVersion', 'plan', 's', 'Synthetic P') },
        versions: [{ assessment: s('VisitNoteVersion', 'assessment', 's', 'Synthetic A') }],
        aiScribeSession: { aiDraft: s('AIScribeSession', 'aiDraft', 'j', { plan: 'x' }) },
      },
    ]
    const opened = openResult(result) as typeof result
    expect(opened[0]).toMatchObject({
      subjective: 'Synthetic S',
      currentVersion: { plan: 'Synthetic P' },
      versions: [{ assessment: 'Synthetic A' }],
      aiScribeSession: { aiDraft: { plan: 'x' } },
    })
    expect(opened[0]!.createdAt).toBeInstanceOf(Date)
  })

  it('refuses filters on encrypted columns but allows null checks', () => {
    expect(() =>
      assertNoEncryptedFilter('AIScribeSession', { where: { transcript: { contains: 'pain' } } })
    ).toThrow(/cannot be filtered/)
    expect(() =>
      assertNoEncryptedFilter('VisitRecord', { where: { AND: [{ subjective: 'x' }] } })
    ).toThrow(/cannot be filtered/)
    expect(() =>
      assertNoEncryptedFilter('AIScribeSession', {
        where: { clinicId: 'c', patientSummary: { not: Prisma.AnyNull } },
      })
    ).not.toThrow()
    expect(() =>
      assertNoEncryptedFilter('VisitRecord', { where: { note: null, clinicId: 'c' } })
    ).not.toThrow()
  })
})

describe('key providers', () => {
  it('parses key lists and validates sizes / active kid', () => {
    expect(parseKeyList(`a:${K1},b:${K2}`).map(([k]) => k)).toEqual(['a', 'b'])
    expect(() => parseKeyList('nokid')).toThrow()
    expect(() => loadEnvKeyring({ FIELD_ENCRYPTION_KEYS: 'k1:abcd' } as NodeJS.ProcessEnv)).toThrow(
      /64 hex/
    )
    expect(() =>
      loadEnvKeyring({ FIELD_ENCRYPTION_KEYS: `k1:${K1},k2:${K2}` } as NodeJS.ProcessEnv)
    ).toThrow(/ACTIVE_KID is required/)
    expect(() =>
      loadEnvKeyring({
        FIELD_ENCRYPTION_KEYS: `k1:${K1}`,
        FIELD_ENCRYPTION_ACTIVE_KID: 'k9',
      } as NodeJS.ProcessEnv)
    ).toThrow(/not in the key list/)
    expect(
      loadEnvKeyring({ FIELD_ENCRYPTION_KEYS: `k1:${K1}` } as NodeJS.ProcessEnv)?.activeKid
    ).toBe('k1')
  })

  it('aws-kms: unwraps each data key with the purpose/kid encryption context', async () => {
    const plain = new Map([
      ['wrapped-1', crypto.randomBytes(32)],
      ['wrapped-2', crypto.randomBytes(32)],
    ])
    const calls: Record<string, string>[] = []
    const decrypt = (blob: Buffer, ctx: Record<string, string>) => {
      calls.push(ctx)
      return Promise.resolve(plain.get(blob.toString())!)
    }
    const env = {
      FIELD_ENCRYPTION_PROVIDER: 'aws-kms',
      FIELD_ENCRYPTION_KMS_WRAPPED_KEYS: `k1:${Buffer.from('wrapped-1').toString('base64')},k2:${Buffer.from('wrapped-2').toString('base64')}`,
      FIELD_ENCRYPTION_ACTIVE_KID: 'k2',
    } as NodeJS.ProcessEnv
    const ring = await loadKmsKeyring(env, decrypt)
    expect(ring?.activeKid).toBe('k2')
    expect(ring?.keys.get('k1')).toEqual(plain.get('wrapped-1'))
    expect(calls).toEqual([
      { purpose: KMS_ENCRYPTION_CONTEXT_PURPOSE, kid: 'k1' },
      { purpose: KMS_ENCRYPTION_CONTEXT_PURPOSE, kid: 'k2' },
    ])

    // Once initialised, sealing uses the KMS-unwrapped key.
    vi.stubEnv('FIELD_ENCRYPTION_PROVIDER', 'aws-kms')
    await initFieldEncryption(env, decrypt)
    const sealed = sealField('VoiceCall', 'summary', 's', 'Synthetic') as string
    expect(parseEnvelope(sealed).kid).toBe('k2')
    expect(openField(sealed, 'summary')).toBe('Synthetic')
  })

  it('production boot: missing or broken key configuration is fatal', () => {
    const base = {
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      CORS_ORIGIN: 'https://app',
      S3_ACCESS_KEY_ID: 'x',
      S3_SECRET_ACCESS_KEY: 'y',
    }
    const fatalFieldKey = (env: Record<string, string>) =>
      collectEnvProblems(env as NodeJS.ProcessEnv).some(
        (p) => p.fatal && /FIELD_ENCRYPTION/.test(p.message)
      )
    expect(fatalFieldKey(base)).toBe(true)
    expect(fatalFieldKey({ ...base, FIELD_ENCRYPTION_KEYS: `k1:${K1}` })).toBe(false)
    expect(fatalFieldKey({ ...base, FIELD_ENCRYPTION_PROVIDER: 'aws-kms' })).toBe(true)
    expect(
      fieldEncryptionConfigProblem({ FIELD_ENCRYPTION_PROVIDER: 'vault' } as NodeJS.ProcessEnv)
    ).toMatch(/must be/)
  })
})
