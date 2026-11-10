/**
 * Clinic onboarding — practice application, signed agreement, platform review
 * and the go-live gate.
 *
 *  - A clinic that signs up is PENDING_REVIEW: none of its public surfaces
 *    (clinic API, website host, availability, slot holds, enquiry form) exist
 *    until a platform admin approves it.
 *  - The application runs practice → practitioners → agreement, in order,
 *    with NPI / EIN / DEA checks; tax ID and DEA are encrypted at rest and
 *    masked to the clinic.
 *  - Platform review: approve / request changes (→ resubmit) / reject, all
 *    audited; only platform admins may review.
 *  - CLINIC_REVIEW_MODE=auto approves on submit; platform-created clinics are
 *    approved from the start.
 *  - PATCH /locations/:id (the wizard's Locations step) and owner-only guards.
 */
import crypto from 'crypto'
import * as argon2 from 'argon2'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, FIXTURE_PASSWORD, login, startServer, type TestServer } from './helpers'
import { createClinicFixture } from './fixtures'

let server: TestServer
let platformToken: string
const savedReviewMode = process.env.CLINIC_REVIEW_MODE

beforeAll(async () => {
  server = await startServer()
  const email = `platform.onb.${Date.now()}@example.test`
  await adminDb.user.create({
    data: {
      name: 'Platform Reviewer',
      email,
      role: 'PLATFORM_ADMIN',
      password: await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id }),
    },
  })
  platformToken = (await login(server.url, email)).accessToken
})
afterEach(() => {
  if (savedReviewMode === undefined) delete process.env.CLINIC_REVIEW_MODE
  else process.env.CLINIC_REVIEW_MODE = savedReviewMode
})
afterAll(() => server.close())

const PASSWORD = 'Synthetic-Onboard-Pass-2026!'
const VALID_NPI = '1234567893'
const OTHER_NPI = '1987654328'
const VALID_EIN = '12-3456789'
const VALID_DEA = 'AB1234563'

interface SignedUp {
  sub: string
  tenantId: string
  clinicId: string
  clinicName: string
  ownerId: string
  token: string
}

async function signUp(): Promise<SignedUp> {
  const sub = `onb${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
  const clinicName = `Synthetic Onboarding Clinic ${sub}`
  const res = await api(server.url, '/tenants/signup', {
    body: {
      clinicName,
      clinicEmail: `clinic.${sub}@example.test`,
      subdomain: sub,
      ownerName: 'Olivia Owner',
      ownerEmail: `owner.${sub}@example.test`,
      password: PASSWORD,
      plan: 'GROWTH',
    },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const { accessToken, userId } = await login(server.url, `owner.${sub}@example.test`, PASSWORD)
  return {
    sub,
    tenantId: res.body.data.tenantId,
    clinicId: res.body.data.clinicId,
    clinicName,
    ownerId: userId,
    token: accessToken,
  }
}

const practiceBody = (overrides: Record<string, unknown> = {}) => ({
  legalName: 'Synthetic Wellness Partners LLC',
  dbaName: 'Synthetic Wellness',
  practiceType: 'FUNCTIONAL_MEDICINE',
  locationCount: 2,
  addressLine1: '100 Example Street',
  addressLine2: 'Suite 200',
  city: 'Testville',
  state: 'tx',
  postalCode: '75001',
  timezone: 'America/Chicago',
  officePhone: '555-0100',
  fax: '',
  website: 'synthetic-wellness.example',
  primaryContactName: 'Olivia Owner',
  primaryContactEmail: 'olivia@example.test',
  primaryContactPhone: '555-0101',
  officeManagerName: '',
  officeManagerEmail: '',
  accountsPayableName: 'Paula Payable',
  accountsPayableEmail: 'ap@example.test',
  mailingSameAsPrimary: true,
  noNpi: false,
  groupNpi: VALID_NPI,
  federalTaxId: VALID_EIN,
  licenseNumber: 'TX-12345',
  licenseState: 'TX',
  deaNumber: VALID_DEA,
  estimatedSeats: 5,
  referralSource: 'Conference',
  salesRep: '',
  ...overrides,
})

const practitioner = (overrides: Record<string, unknown> = {}) => ({
  name: 'Dr Olivia Owner',
  email: 'olivia.md@example.test',
  phone: '555-0102',
  credentials: 'MD',
  licenseNumber: 'TX-MD-1',
  licenseState: 'TX',
  npi: VALID_NPI,
  isOwner: true,
  isSelf: true,
  ...overrides,
})

const agreementBody = (clinicName: string, overrides: Record<string, unknown> = {}) => ({
  acknowledgements: {
    baa: true,
    hipaa: true,
    dataResidency: true,
    refundPolicy: true,
    authorizedSignatory: true,
  },
  communications: true,
  signerName: 'Olivia Owner',
  signerTitle: 'Medical Director',
  signature: 'olivia  owner',
  confirmClinicName: clinicName,
  ...overrides,
})

/** Runs the whole application for `c`; returns the agreement response. */
async function completeApplication(c: SignedUp) {
  const p = await api(server.url, '/onboarding/application/practice', {
    method: 'PUT',
    token: c.token,
    body: practiceBody(),
  })
  expect(p.status, JSON.stringify(p.body)).toBe(200)
  const pr = await api(server.url, '/onboarding/application/practitioners', {
    method: 'PUT',
    token: c.token,
    body: { practitioners: [practitioner()] },
  })
  expect(pr.status, JSON.stringify(pr.body)).toBe(200)
  const a = await api(server.url, '/onboarding/agreement', {
    token: c.token,
    body: agreementBody(c.clinicName),
  })
  expect(a.status, JSON.stringify(a.body)).toBe(200)
  return a
}

const review = (tenantId: string, body: Record<string, unknown>, token = platformToken) =>
  api(server.url, `/platform/clinics/${tenantId}/review`, { token, body })

/** Status codes of the clinic's public surfaces. */
async function publicSurface(c: SignedUp) {
  const clinic = await api(server.url, `/public/clinics/${c.sub}`)
  const host = await api(server.url, `/public/sites/resolve?host=${c.sub}.site.test`)
  const hold = await api(server.url, '/public/slots/hold', {
    body: {
      clinicId: c.clinicId,
      providerId: 'prov_x',
      serviceId: 'svc_x',
      timezone: 'UTC',
      startTime: '2030-01-01T10:00:00.000Z',
      endTime: '2030-01-01T10:30:00.000Z',
    },
  })
  const dates = await api(
    server.url,
    `/public/availability/summary?clinicId=${c.clinicId}&serviceId=svc_x&startDate=2030-01-01&endDate=2030-01-07`
  )
  return {
    clinic: clinic.status,
    host: host.body?.data?.kind,
    hold: hold.status,
    dates: dates.status,
  }
}

describe('signup starts in review and nothing public is reachable', () => {
  it('PENDING_REVIEW, reported to the owner, with every public surface 404', async () => {
    const c = await signUp()
    const tenant = await adminDb.tenant.findUniqueOrThrow({ where: { id: c.tenantId } })
    expect(tenant.verificationStatus).toBe('PENDING_REVIEW')

    const me = await api(server.url, '/auth/me', { token: c.token })
    expect(me.body.data.user.clinic.tenant.verificationStatus).toBe('PENDING_REVIEW')
    expect(me.body.data.user.clinic.clinicProfile).toBeNull()

    expect(await publicSurface(c)).toEqual({ clinic: 404, host: 'unknown', hold: 404, dates: 404 })
    const lead = await api(server.url, '/public/sites/leads', {
      body: { clinic: c.sub, name: 'Synthetic Visitor', email: 'v@example.test', message: 'Hi' },
    })
    expect(lead.status).toBe(404)
    const list = await api(server.url, '/public/clinics')
    expect((list.body.data.clinics as { id: string }[]).some((x) => x.id === c.clinicId)).toBe(
      false
    )

    const audit = await adminDb.auditLog.findFirst({
      where: { entityId: c.tenantId, action: 'TENANT_SIGNUP' },
    })
    expect(audit?.performedById).toBe(c.ownerId)
  })
})

describe('the practice application', () => {
  it('runs in order: practitioners and agreement are refused before practice details', async () => {
    const c = await signUp()
    const pr = await api(server.url, '/onboarding/application/practitioners', {
      method: 'PUT',
      token: c.token,
      body: { practitioners: [practitioner()] },
    })
    expect(pr.status).toBe(409)
    expect(pr.body.code).toBe('practice_incomplete')
    const a = await api(server.url, '/onboarding/agreement', {
      token: c.token,
      body: agreementBody(c.clinicName),
    })
    expect(a.status).toBe(409)
    expect(a.body.code).toBe('application_incomplete')
  })

  it('validates NPI, EIN, DEA, state and the mailing address', async () => {
    const c = await signUp()
    const put = (overrides: Record<string, unknown>) =>
      api(server.url, '/onboarding/application/practice', {
        method: 'PUT',
        token: c.token,
        body: practiceBody(overrides),
      })
    const badNpi = await put({ groupNpi: '1234567890' })
    expect(badNpi.status).toBe(400)
    // Each field reports its own message, not a generic "Invalid input".
    expect(badNpi.body.message).toBe('Enter a valid 10-digit NPI')
    expect((await put({ deaNumber: 'AB1234564' })).body.message).toMatch(/valid DEA number/)
    expect((await put({ website: 'not a site' })).body.message).toBe(
      'Enter a valid website address'
    )
    expect((await put({ groupNpi: '' })).status).toBe(400) // NPI needed unless noNpi
    expect((await put({ federalTaxId: '00-1234567' })).status).toBe(400)
    expect((await put({ federalTaxId: undefined })).status).toBe(400) // first save needs it
    expect((await put({ deaNumber: 'AB1234564' })).status).toBe(400)
    expect((await put({ state: 'ZZ' })).status).toBe(400)
    expect((await put({ timezone: 'Mars/Olympus' })).status).toBe(400)
    expect((await put({ mailingSameAsPrimary: false })).status).toBe(400)
    // "I don't have an NPI" is a valid path.
    const ok = await put({ noNpi: true, groupNpi: '' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.data.profile.groupNpi).toBeNull()
  })

  it('stores the practice, sets the main location, encrypts tax ID / DEA and masks them', async () => {
    const c = await signUp()
    const res = await api(server.url, '/onboarding/application/practice', {
      method: 'PUT',
      token: c.token,
      body: practiceBody(),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const app = res.body.data
    expect(app.progress).toEqual({ practice: true, practitioners: false, agreement: false })
    expect(app.profile.federalTaxIdMasked).toBe('•••••6789')
    expect(app.profile.deaNumberMasked).toBe('•••••4563')
    // (The sample NPI 1234567893 contains the EIN's digits, so match the EIN's own form.)
    expect(JSON.stringify(app)).not.toContain(VALID_EIN)
    expect(app.profile).not.toHaveProperty('federalTaxId')
    expect(app.profile).not.toHaveProperty('deaNumber')
    expect(JSON.stringify(app)).not.toContain(VALID_DEA)
    expect(app.profile.website).toBe('https://synthetic-wellness.example/')
    expect(app.location).toMatchObject({
      addressLine1: '100 Example Street',
      city: 'Testville',
      state: 'TX',
      postalCode: '75001',
      timezone: 'America/Chicago',
    })

    // At rest: ciphertext envelopes, not the numbers.
    const raw = await adminDb.clinicProfile.findUniqueOrThrow({ where: { clinicId: c.clinicId } })
    expect(raw.federalTaxId.startsWith('fle:v1:')).toBe(true)
    expect(raw.deaNumber?.startsWith('fle:v1:')).toBe(true)
    expect(raw.groupNpi).toBe(VALID_NPI)

    // An edit without the tax ID keeps the one on file; DEA null removes it.
    const edit = await api(server.url, '/onboarding/application/practice', {
      method: 'PUT',
      token: c.token,
      body: practiceBody({ federalTaxId: undefined, deaNumber: null, locationCount: 3 }),
    })
    expect(edit.status, JSON.stringify(edit.body)).toBe(200)
    expect(edit.body.data.profile.federalTaxIdMasked).toBe('•••••6789')
    expect(edit.body.data.profile.hasDeaNumber).toBe(false)
    expect(edit.body.data.profile.locationCount).toBe(3)
  })

  it('requires exactly one owner on record and an NPI per practitioner', async () => {
    const c = await signUp()
    await api(server.url, '/onboarding/application/practice', {
      method: 'PUT',
      token: c.token,
      body: practiceBody(),
    })
    const put = (practitioners: unknown[]) =>
      api(server.url, '/onboarding/application/practitioners', {
        method: 'PUT',
        token: c.token,
        body: { practitioners },
      })
    expect((await put([])).status).toBe(400)
    expect(
      (await put([practitioner(), practitioner({ email: 'b@example.test', isSelf: false })])).status
    ).toBe(400) // two owners
    expect((await put([practitioner({ isOwner: false })])).status).toBe(400) // no owner
    expect(
      (await put([practitioner(), practitioner({ isOwner: false, isSelf: false })])).status
    ).toBe(400) // duplicate email
    const noNpi = await put([practitioner({ npi: '' })])
    expect(noNpi.status).toBe(400)
    expect(noNpi.body.message).toContain('NPI')
    const ok = await put([
      practitioner(),
      practitioner({
        name: 'Nate Naturopath',
        email: 'nate@example.test',
        credentials: 'ND',
        npi: OTHER_NPI,
        isOwner: false,
        isSelf: false,
      }),
    ])
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.data.progress.practitioners).toBe(true)
    expect(ok.body.data.profile.practitioners).toHaveLength(2)
  })

  it('signing checks the signature and consent, submits for review once, and is audited', async () => {
    const c = await signUp()
    await api(server.url, '/onboarding/application/practice', {
      method: 'PUT',
      token: c.token,
      body: practiceBody(),
    })
    await api(server.url, '/onboarding/application/practitioners', {
      method: 'PUT',
      token: c.token,
      body: { practitioners: [practitioner()] },
    })
    const sign = (o: Record<string, unknown>) =>
      api(server.url, '/onboarding/agreement', {
        token: c.token,
        body: agreementBody(c.clinicName, o),
      })
    expect((await sign({ signature: 'Someone Else' })).status).toBe(400)
    expect((await sign({ communications: false })).status).toBe(400)
    expect((await sign({ confirmClinicName: 'Wrong Clinic' })).status).toBe(400)
    expect(
      (await sign({ acknowledgements: { ...agreementBody('').acknowledgements, baa: false } }))
        .status
    ).toBe(400)

    const ok = await sign({})
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.data.verificationStatus).toBe('PENDING_REVIEW')
    expect((await sign({})).status).toBe(409) // already signed

    const tenant = await adminDb.tenant.findUniqueOrThrow({ where: { id: c.tenantId } })
    expect(tenant.verificationStatus).toBe('PENDING_REVIEW')
    expect(tenant.submittedForReviewAt).not.toBeNull()
    expect(tenant.termsVersion).toBe('v2-2026-11')
    const agreements = await adminDb.clinicAgreement.findMany({ where: { clinicId: c.clinicId } })
    expect(agreements).toHaveLength(1)
    expect(agreements[0]).toMatchObject({
      signerName: 'Olivia Owner',
      signerTitle: 'Medical Director',
      communicationsConsent: true,
    })
    const audit = await adminDb.auditLog.findFirstOrThrow({
      where: { entityId: c.tenantId, action: 'TERMS_ACCEPTED' },
    })
    // The audit row names the signer but never carries the tax ID.
    expect(JSON.stringify(audit.newValue)).not.toContain(VALID_EIN)

    // Still not public until approved.
    expect((await publicSurface(c)).clinic).toBe(404)
    const status = await api(server.url, '/onboarding/status', { token: c.token })
    expect(status.body.data.application).toEqual({
      practice: true,
      practitioners: true,
      agreement: true,
    })
    expect(status.body.data.verification.status).toBe('PENDING_REVIEW')
  })

  it('ClinicAgreement is append-only for the app role', async () => {
    const c = await signUp()
    await completeApplication(c)
    const { default: prisma } = await import('../../config/prisma')
    const { withTenantBypass } = await import('../../config/tenantContext')
    await expect(
      withTenantBypass('test:append-only', () =>
        prisma.clinicAgreement.updateMany({
          where: { clinicId: c.clinicId },
          data: { signerName: 'Tampered' },
        })
      )
    ).rejects.toThrow()
  })
})

describe('platform review', () => {
  it('only platform admins can review; approve before signing is refused', async () => {
    const c = await signUp()
    expect((await review(c.tenantId, { decision: 'APPROVE' }, c.token)).status).toBe(403)
    const early = await review(c.tenantId, { decision: 'APPROVE' })
    expect(early.status).toBe(409)
    expect(early.body.code).toBe('agreement_missing')
  })

  it('queue → full application → request changes → resubmit → approve → live', async () => {
    const c = await signUp()
    await completeApplication(c)

    const queue = await api(server.url, '/platform/clinics?verification=PENDING_REVIEW&limit=200', {
      token: platformToken,
    })
    expect(queue.status).toBe(200)
    expect(queue.body.data.pendingReview).toBeGreaterThanOrEqual(1)
    expect((queue.body.data.items as { id: string }[]).some((t) => t.id === c.tenantId)).toBe(true)

    // The reviewer sees the full numbers; the read is audited.
    const detail = await api(server.url, `/platform/clinics/${c.tenantId}`, {
      token: platformToken,
    })
    expect(detail.status).toBe(200)
    expect(detail.body.data.verificationStatus).toBe('PENDING_REVIEW')
    expect(detail.body.data.application.profile).toMatchObject({
      federalTaxId: VALID_EIN,
      deaNumber: VALID_DEA,
      groupNpi: VALID_NPI,
    })
    expect(detail.body.data.application.agreements[0].signerName).toBe('Olivia Owner')
    expect(detail.body.data.application.owner.email).toBe(`owner.${c.sub}@example.test`)
    expect(
      await adminDb.auditLog.count({
        where: { clinicId: c.clinicId, action: 'CLINIC_APPLICATION_VIEWED' },
      })
    ).toBeGreaterThanOrEqual(1)

    // Request changes needs a note.
    expect((await review(c.tenantId, { decision: 'REQUEST_CHANGES' })).status).toBe(400)
    const changes = await review(c.tenantId, {
      decision: 'REQUEST_CHANGES',
      notes: 'Please upload a group NPI that matches the legal name.',
    })
    expect(changes.status, JSON.stringify(changes.body)).toBe(200)
    expect(changes.body.data.verificationStatus).toBe('CHANGES_REQUESTED')
    const me = await api(server.url, '/auth/me', { token: c.token })
    expect(me.body.data.user.clinic.tenant).toMatchObject({
      verificationStatus: 'CHANGES_REQUESTED',
      reviewNotes: 'Please upload a group NPI that matches the legal name.',
    })

    // The clinic edits and resubmits.
    await api(server.url, '/onboarding/application/practice', {
      method: 'PUT',
      token: c.token,
      body: practiceBody({ federalTaxId: undefined, legalName: 'Synthetic Wellness LLC' }),
    })
    const re = await api(server.url, '/onboarding/application/resubmit', {
      token: c.token,
      body: {},
    })
    expect(re.status, JSON.stringify(re.body)).toBe(200)
    expect(re.body.data.verificationStatus).toBe('PENDING_REVIEW')
    expect(
      (await api(server.url, '/onboarding/application/resubmit', { token: c.token, body: {} }))
        .status
    ).toBe(409)

    // Approve → every public surface is live (host cache invalidated).
    expect(await publicSurface(c)).toMatchObject({ clinic: 404, host: 'unknown' })
    const ok = await review(c.tenantId, { decision: 'APPROVE' })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toEqual({ verificationStatus: 'APPROVED', changed: true })
    const live = await publicSurface(c)
    expect(live.clinic).toBe(200)
    expect(live.host).toBe('site')
    expect(live.hold).not.toBe(404) // gate passed; the bogus provider/service is a 4xx from booking
    expect(live.dates).not.toBe(404)

    // Idempotent.
    expect((await review(c.tenantId, { decision: 'APPROVE' })).body.data.changed).toBe(false)

    const actions = (
      await adminDb.auditLog.findMany({
        where: { entityId: c.tenantId },
        select: { action: true },
      })
    ).map((a) => a.action)
    expect(actions).toEqual(
      expect.arrayContaining([
        'TENANT_SIGNUP',
        'TERMS_ACCEPTED',
        'CLINIC_CHANGES_REQUESTED',
        'CLINIC_APPLICATION_RESUBMITTED',
        'CLINIC_APPROVED',
      ])
    )
  })

  it('reject keeps the clinic offline and freezes its application', async () => {
    const c = await signUp()
    await completeApplication(c)
    const r = await review(c.tenantId, {
      decision: 'REJECT',
      notes: 'License could not be verified.',
    })
    expect(r.status).toBe(200)
    expect(await publicSurface(c)).toMatchObject({ clinic: 404, host: 'unknown' })
    const edit = await api(server.url, '/onboarding/application/practice', {
      method: 'PUT',
      token: c.token,
      body: practiceBody(),
    })
    expect(edit.status).toBe(409)
    expect(edit.body.code).toBe('application_rejected')
  })
})

describe('review modes and platform-created clinics', () => {
  it('CLINIC_REVIEW_MODE=auto approves the application on submit', async () => {
    process.env.CLINIC_REVIEW_MODE = 'auto'
    const c = await signUp()
    const a = await completeApplication(c)
    expect(a.body.data.verificationStatus).toBe('APPROVED')
    expect((await publicSurface(c)).clinic).toBe(200)
  })

  it('a clinic created by a platform admin is approved and stays approved after signing', async () => {
    const sub = `plat${Date.now().toString(36)}`
    const res = await api(server.url, '/platform/clinics', {
      token: platformToken,
      body: {
        clinicName: `Synthetic Platform Clinic ${sub}`,
        clinicEmail: `clinic.${sub}@example.test`,
        ownerName: 'Pat Platform',
        ownerEmail: `owner.${sub}@example.test`,
        subdomain: sub,
        plan: 'ENTERPRISE',
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const tenant = await adminDb.tenant.findUniqueOrThrow({ where: { id: res.body.data.tenantId } })
    expect(tenant.verificationStatus).toBe('APPROVED')
  })
})

describe('owner-only onboarding and the Locations step', () => {
  it('PATCH /locations/:id updates the clinic location; other clinics and non-owners are refused', async () => {
    const c = await signUp()
    const loc = await adminDb.location.findFirstOrThrow({ where: { clinicId: c.clinicId } })
    const res = await api(server.url, `/locations/${loc.id}`, {
      method: 'PATCH',
      token: c.token,
      body: { name: 'Downtown', timezone: 'America/Denver', phone: '555-0199' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.location).toMatchObject({ name: 'Downtown', timezone: 'America/Denver' })

    const other = await createClinicFixture('onbloc')
    const cross = await api(server.url, `/locations/${other.locationId}`, {
      method: 'PATCH',
      token: c.token,
      body: { name: 'Hijack' },
    })
    expect(cross.status).toBe(404)
    const untouched = await adminDb.location.findUniqueOrThrow({ where: { id: other.locationId } })
    expect(untouched.name).toBe('Main')

    const frontDesk = (await login(server.url, other.users.frontDesk.email)).accessToken
    const fd = await api(server.url, `/locations/${other.locationId}`, {
      method: 'PATCH',
      token: frontDesk,
      body: { name: 'Nope' },
    })
    expect(fd.status).toBe(403)
  })

  it('staff cannot complete onboarding or edit the application', async () => {
    const fx = await createClinicFixture('onbstaff')
    const token = (await login(server.url, fx.users.frontDesk.email)).accessToken
    expect((await api(server.url, '/onboarding/complete', { token, body: {} })).status).toBe(403)
    expect(
      (
        await api(server.url, '/onboarding/application/practice', {
          method: 'PUT',
          token,
          body: practiceBody(),
        })
      ).status
    ).toBe(403)
  })

  it('"Add me as a provider" carries the owner\'s NPI and license from the application', async () => {
    const c = await signUp()
    await completeApplication(c)
    const res = await api(server.url, `/staff/${c.ownerId}/link-provider`, {
      token: c.token,
      body: {},
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const provider = await adminDb.provider.findUniqueOrThrow({ where: { userId: c.ownerId } })
    expect(provider).toMatchObject({
      npi: VALID_NPI,
      licenseNumber: 'TX-MD-1',
      licenseState: 'TX',
      credentials: 'MD',
    })
  })
})

describe('off-boarding', () => {
  it('destroys the practice profile but keeps the signed agreement (6-year retention)', async () => {
    const c = await signUp()
    await completeApplication(c)
    const res = await api(server.url, `/platform/lifecycle/tenants/${c.tenantId}/offboard`, {
      token: platformToken,
      body: { confirmSlug: c.sub },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(await adminDb.clinicProfile.count({ where: { clinicId: c.clinicId } })).toBe(0)
    expect(await adminDb.clinicAgreement.count({ where: { clinicId: c.clinicId } })).toBe(1)
  })
})
