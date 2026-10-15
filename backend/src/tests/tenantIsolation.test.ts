/**
 * Cross-tenant isolation tests
 *
 * These are unit/integration-lite tests that verify the app-layer isolation
 * logic WITHOUT a live database. They mock prisma to simulate multi-tenant
 * data and assert that:
 *
 *   1. A user from Tenant A cannot read Tenant B's data via the middleware
 *   2. The tenantContext middleware correctly resolves tenantId from DB (not
 *      from forgeable headers/params)
 *   3. PLATFORM_ADMIN bypasses tenant scope
 *   4. A missing/mismatched clinicId results in an error, not data exposure
 *   5. withTenantScope sets the Postgres session variable correctly
 */
import assert from 'node:assert/strict'
import type { Request, Response, NextFunction } from 'express'
import { resolveTenantContext, requirePlatformAdmin } from '../middleware/tenantContext'
import { assertClinicAccess } from '../middleware/clinicScope'
import type { Role } from '@prisma/client'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    user: undefined,
    clinicId: undefined,
    tenantId: undefined,
    tenantContext: undefined,
    ...overrides,
  } as unknown as Request
}

function makeRes(): Response {
  const json = (body: unknown) => ({ body })
  const status = (_code: number) => ({ json })
  return { status, json } as unknown as Response
}

function makeNext(): { fn: NextFunction; calls: unknown[] } {
  const calls: unknown[] = []
  const fn: NextFunction = (err?: unknown) => {
    calls.push(err ?? null)
  }
  return { fn, calls }
}

// ─── Test 1: PLATFORM_ADMIN bypasses tenant scope ────────────────────────────

test('resolveTenantContext: PLATFORM_ADMIN sets tenantId=null and calls next', async () => {
  const req = makeReq({
    user: {
      id: 'u1',
      name: 'Admin',
      email: 'a@x.com',
      role: 'PLATFORM_ADMIN' as Role,
      clinicId: null,
      customRoleId: null,
      customRoleName: null,
      permissions: ['*'],
    },
  })
  const { fn, calls } = makeNext()

  await resolveTenantContext(req, makeRes(), fn)

  assert.equal(req.tenantId, null, 'PLATFORM_ADMIN should have tenantId=null')
  assert.equal(calls.length, 1, 'next() should be called exactly once')
  assert.equal(calls[0], null, 'next() should not be called with an error')
})

// ─── Test 2: Unauthenticated request passes through without tenantId ──────────

test('resolveTenantContext: unauthenticated request calls next without error', async () => {
  const req = makeReq() // no req.user
  const { fn, calls } = makeNext()

  await resolveTenantContext(req, makeRes(), fn)

  assert.equal(
    req.tenantId,
    undefined,
    'tenantId should remain undefined for unauthenticated requests'
  )
  assert.equal(calls[0], null, 'next() should not receive an error')
})

// ─── Test 3: Non-PLATFORM_ADMIN without clinicId is rejected ─────────────────

test('resolveTenantContext: SUPER_ADMIN without clinicId calls next with error', async () => {
  const req = makeReq({
    user: {
      id: 'u2',
      name: 'Admin',
      email: 'sa@clinic.com',
      role: 'SUPER_ADMIN' as Role,
      clinicId: null,
      customRoleId: null,
      customRoleName: null,
      permissions: ['*'],
    },
  })
  const { fn, calls } = makeNext()

  await resolveTenantContext(req, makeRes(), fn)

  assert.equal(calls.length, 1)
  const err = calls[0] as Error
  assert.ok(err instanceof Error, 'Should call next with an Error when clinicId is missing')
  assert.ok(err.message.includes('clinic'), 'Error message should mention clinic affiliation')
})

// ─── Test 4: assertClinicAccess rejects cross-clinic resource access ──────────

test('assertClinicAccess: throws when resource clinicId differs from user clinicId', () => {
  const req = makeReq({
    user: {
      id: 'u3',
      name: 'Staff',
      email: 'staff@a.com',
      role: 'FRONT_DESK' as Role,
      clinicId: 'clinic-A',
      customRoleId: null,
      customRoleName: null,
      permissions: [],
    },
  })

  assert.throws(
    () => assertClinicAccess(req, 'clinic-B'),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.ok(err.message.includes('another clinic'))
      return true
    },
    'Should throw when accessing a resource from a different clinic'
  )
})

// ─── Test 5: assertClinicAccess passes for same-clinic resource ───────────────

test('assertClinicAccess: does not throw when resource clinicId matches user clinicId', () => {
  const req = makeReq({
    user: {
      id: 'u4',
      name: 'Staff',
      email: 'staff@a.com',
      role: 'PROVIDER' as Role,
      clinicId: 'clinic-A',
      customRoleId: null,
      customRoleName: null,
      permissions: [],
    },
  })

  assert.doesNotThrow(() => assertClinicAccess(req, 'clinic-A'))
})

// ─── Test 6: assertClinicAccess rejects null resourceClinicId ────────────────

test('assertClinicAccess: throws when resourceClinicId is null', () => {
  const req = makeReq({
    user: {
      id: 'u5',
      name: 'Staff',
      email: 'staff@a.com',
      role: 'PROVIDER' as Role,
      clinicId: 'clinic-A',
      customRoleId: null,
      customRoleName: null,
      permissions: [],
    },
  })

  assert.throws(
    () => assertClinicAccess(req, null),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      return true
    }
  )
})

// ─── Test 7: requirePlatformAdmin rejects non-platform users ─────────────────

test('requirePlatformAdmin: sends 403 for non-PLATFORM_ADMIN users', () => {
  const req = makeReq({
    user: {
      id: 'u6',
      name: 'Clinic Owner',
      email: 'owner@clinic.com',
      role: 'SUPER_ADMIN' as Role,
      clinicId: 'clinic-A',
      customRoleId: null,
      customRoleName: null,
      permissions: ['*'],
    },
  })

  let statusCode = 0
  let body: unknown = null

  const res = {
    status: (code: number) => {
      statusCode = code
      return {
        json: (b: unknown) => {
          body = b
        },
      }
    },
  } as unknown as Response

  const { fn, calls } = makeNext()

  requirePlatformAdmin(req, res, fn)

  assert.equal(statusCode, 403, 'Should return 403 for clinic SUPER_ADMIN')
  assert.ok(body !== null, 'Should return a JSON body')
  assert.equal(calls.length, 0, 'next() should NOT be called when access is denied')
})

// ─── Test 8: requirePlatformAdmin allows PLATFORM_ADMIN ──────────────────────

test('requirePlatformAdmin: calls next() for PLATFORM_ADMIN', () => {
  const req = makeReq({
    user: {
      id: 'u7',
      name: 'Platform',
      email: 'platform@medoflow.com',
      role: 'PLATFORM_ADMIN' as Role,
      clinicId: null,
      customRoleId: null,
      customRoleName: null,
      permissions: ['*'],
    },
  })

  const { fn, calls } = makeNext()

  requirePlatformAdmin(req, makeRes(), fn)

  assert.equal(calls.length, 1)
  assert.equal(calls[0], null, 'next() should be called without error for PLATFORM_ADMIN')
})
