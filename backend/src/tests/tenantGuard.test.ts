/**
 * B0.1.2 — the tenant guard checks clinicId === the caller's context:
 *  (a) a query naming another clinic is rejected,
 *  (b) a scoped-model query without clinicId is rejected,
 *  (c) a same-clinic query passes.
 * Plus: the guarded model list matches the schema, and violation logs carry no values.
 */
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import type { TenantScopeError } from '../config/prisma'
import {
  assertTenantScope,
  CLINIC_SCOPED_MODELS,
  CLINIC_COLUMN_UNGUARDED_MODELS,
} from '../config/prisma'
import {
  clinicScope,
  withTenantBypass,
  withTenantContext,
  type TenantContext,
} from '../config/tenantContext'

const staff: TenantContext = {
  clinicId: 'clinic_a',
  tenantId: 't',
  userId: 'u',
  role: 'FRONT_DESK',
  bypassReason: null,
}
const patient: TenantContext = {
  ...staff,
  role: 'PATIENT',
  allowedClinicIds: ['clinic_a', 'clinic_c'],
}
const run = (model: string, op: string, args: unknown, ctx: TenantContext | undefined = staff) =>
  assertTenantScope(model, op, args, ctx, 'enforce')

const code = (fn: () => void) => {
  try {
    fn()
    return null
  } catch (err) {
    return (err as TenantScopeError).code
  }
}

describe('tenant guard (enforce)', () => {
  it('(a) rejects a query whose clinicId differs from the caller context', () => {
    expect(
      code(() => run('Invoice', 'findFirst', { where: { id: 'x', clinicId: 'clinic_b' } }))
    ).toBe('tenant_scope_mismatch')
    expect(
      code(() =>
        run('Invoice', 'findMany', { where: { clinicId: { in: ['clinic_a', 'clinic_b'] } } })
      )
    ).toBe('tenant_scope_mismatch')
    expect(code(() => run('Appointment', 'create', { data: { clinicId: 'clinic_b' } }))).toBe(
      'tenant_scope_mismatch'
    )
    expect(
      code(() =>
        run('Appointment', 'createMany', {
          data: [{ clinicId: 'clinic_a' }, { clinicId: 'clinic_b' }],
        })
      )
    ).toBe('tenant_scope_mismatch')
    expect(
      code(() => run('Payment', 'create', { data: { clinic: { connect: { id: 'clinic_b' } } } }))
    ).toBe('tenant_scope_mismatch')
  })

  it('(a) maps a mismatch to HTTP 403', () => {
    try {
      run('Invoice', 'findFirst', { where: { clinicId: 'clinic_b' } })
    } catch (err) {
      expect((err as TenantScopeError).statusCode).toBe(403)
    }
  })

  it('(b) rejects a scoped-model query with no clinicId, or an unverifiable filter', () => {
    expect(code(() => run('Invoice', 'findUnique', { where: { id: 'x' } }))).toBe(
      'tenant_scope_required'
    )
    expect(code(() => run('Invoice', 'count', {}))).toBe('tenant_scope_required')
    expect(
      code(() =>
        run('Invoice', 'findMany', { where: { OR: [{ clinicId: 'clinic_a' }, { id: 'x' }] } })
      )
    ).toBe('tenant_scope_required')
    expect(
      code(() => run('Invoice', 'findMany', { where: { clinicId: { not: 'clinic_b' } } }))
    ).toBe('tenant_scope_required')
    expect(code(() => run('Appointment', 'create', { data: { patientId: 'p' } }))).toBe(
      'tenant_scope_required'
    )
    // No context at all is never allowed.
    expect(
      code(() =>
        assertTenantScope(
          'Invoice',
          'findFirst',
          { where: { clinicId: 'clinic_a' } },
          undefined,
          'enforce'
        )
      )
    ).toBe('tenant_scope_required')
  })

  it('(c) lets a legitimate same-clinic query through', () => {
    expect(
      code(() => run('Invoice', 'findFirst', { where: { id: 'x', clinicId: 'clinic_a' } }))
    ).toBeNull()
    expect(
      code(() =>
        run('Invoice', 'findFirst', {
          where: { AND: [{ clinicId: 'clinic_a' }, { OR: [{ id: 'x' }] }] },
        })
      )
    ).toBeNull()
    expect(
      code(() =>
        run('CustomRole', 'findUnique', {
          where: { clinicId_name: { clinicId: 'clinic_a', name: 'x' } },
        })
      )
    ).toBeNull()
    expect(
      code(() =>
        run('Appointment', 'upsert', {
          where: { id: 'x', clinicId: 'clinic_a' },
          create: { clinicId: 'clinic_a' },
          update: {},
        })
      )
    ).toBeNull()
    // Patients: any of their member clinics.
    expect(
      code(() =>
        run(
          'Appointment',
          'findMany',
          { where: { clinicId: { in: ['clinic_a', 'clinic_c'] } } },
          patient
        )
      )
    ).toBeNull()
    expect(
      code(() => run('Appointment', 'findMany', { where: { clinicId: 'clinic_d' } }, patient))
    ).toBe('tenant_scope_mismatch')
    // Unscoped models are not checked.
    expect(code(() => run('User', 'findUnique', { where: { id: 'x' } }))).toBeNull()
  })

  it('a named bypass skips the check', () => {
    expect(
      code(() => run('Invoice', 'findMany', {}, { ...staff, bypassReason: 'cron:test' }))
    ).toBeNull()
  })

  it('warn mode logs but does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertTenantScope('Invoice', 'findMany', {}, staff, 'warn')).not.toThrow()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('violation logs show keys only, never values (no PHI in logs)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    code(() =>
      run('Appointment', 'findMany', {
        where: { patient: { name: 'Jane Realname', email: 'jane@clinic.example' } },
      })
    )
    const line = String(warn.mock.calls[0]?.[0])
    expect(line).toContain('where-keys=[patient]')
    expect(line).not.toMatch(/Jane|jane@/)
    warn.mockRestore()
  })
})

describe('clinicScope()', () => {
  it('returns the caller clinic, the patient clinic list, {} under bypass, and a match-nothing filter with no context', () => {
    expect(withTenantContext(staff, () => clinicScope())).toEqual({ clinicId: 'clinic_a' })
    expect(withTenantContext(patient, () => clinicScope())).toEqual({
      clinicId: { in: ['clinic_a', 'clinic_c'] },
    })
    expect(withTenantContext(staff, () => withTenantBypass('x', () => clinicScope()))).toEqual({})
    expect(clinicScope()).toEqual({ clinicId: { in: [] } })
  })

  it('runs a lazy promise returned from the callback inside the scope', async () => {
    const seen: (string | null | undefined)[] = []
    const lazy = {
      then: (res: (v: unknown) => void) => res(seen.push(JSON.stringify(clinicScope()))),
    }
    await withTenantContext(staff, () => lazy)
    expect(seen).toEqual(['{"clinicId":"clinic_a"}'])
  })
})

describe('guarded model list matches the schema', () => {
  it('every model with a required clinicId is guarded; the rest are explicitly exempt', () => {
    const withClinicColumn = Prisma.dmmf.datamodel.models.filter((m) =>
      m.fields.some((f) => f.name === 'clinicId')
    )
    const unguarded = withClinicColumn
      .map((m) => m.name)
      .filter(
        (name) => !CLINIC_SCOPED_MODELS.has(name) && !CLINIC_COLUMN_UNGUARDED_MODELS.has(name)
      )
    expect(unguarded).toEqual([])
    const stale = [...CLINIC_SCOPED_MODELS].filter(
      (name) => !withClinicColumn.some((m) => m.name === name)
    )
    expect(stale).toEqual([])
  })
})
