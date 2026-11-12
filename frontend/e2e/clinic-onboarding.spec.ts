/**
 * Clinic onboarding in the browser (mocked API, stateful):
 *
 *  - The owner of a just-created clinic is held in the application until it
 *    is submitted: practice details (with NPI / EIN check-digit feedback) →
 *    practitioners → agreement + typed signature → "under review".
 *  - Signing goes straight to the dashboard (CTO-25): the review banner and
 *    the Quick setup checklist, with the website optional (CTO-23).
 *  - A platform admin works the review queue: opens the application, requests
 *    changes, then approves.
 */
import { expect, test, type Page, type Route } from '@playwright/test'
import { installMockApi, ok, fail, type MockOnboarding } from './mockApi'

const API = 'http://127.0.0.1:3999/api/v1'
const CLINIC_NAME = 'Synthetic Tenant'

interface Calls {
  key: string
  body: Record<string, unknown>
}

/** A stateful /onboarding + /locations backend for one owner. */
async function mockOnboarding(page: Page, live: MockOnboarding) {
  const calls: Calls[] = []
  const app = {
    clinicName: CLINIC_NAME,
    verification: {
      status: 'PENDING_REVIEW',
      submittedAt: null as string | null,
      reviewedAt: null,
      notes: null,
    },
    progress: { practice: false, practitioners: false, agreement: false },
    profile: null as Record<string, unknown> | null,
    location: {
      id: 'loc-1',
      name: 'Main Location',
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      phone: null,
      timezone: 'UTC',
    } as Record<string, unknown>,
    agreement: null as Record<string, unknown> | null,
  }
  const now = '2026-11-10T10:00:00.000Z'

  const handler = async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    const key = `${req.method()} ${path}`
    const body = (req.postDataJSON?.() ?? {}) as Record<string, unknown>
    calls.push({ key, body })
    switch (key) {
      case 'GET /onboarding/application':
        return ok(route, app)
      case 'PUT /onboarding/application/practice': {
        const { federalTaxId, deaNumber, ...rest } = body
        app.profile = {
          id: 'profile-1',
          ...rest,
          federalTaxIdMasked: federalTaxId ? `•••••${String(federalTaxId).slice(-4)}` : null,
          deaNumberMasked: deaNumber ? `•••••${String(deaNumber).slice(-4)}` : null,
          hasDeaNumber: Boolean(deaNumber),
          practitioners: [],
          practiceCompletedAt: now,
          practitionersCompletedAt: null,
        }
        app.location = {
          ...app.location,
          addressLine1: body.addressLine1,
          city: body.city,
          state: body.state,
          postalCode: body.postalCode,
          timezone: body.timezone,
        }
        app.progress.practice = true
        live.clinicProfile = { practiceCompletedAt: now, practitionersCompletedAt: null }
        return ok(route, app)
      }
      case 'PUT /onboarding/application/practitioners':
        app.profile = {
          ...app.profile,
          practitioners: body.practitioners,
          practitionersCompletedAt: now,
        }
        app.progress.practitioners = true
        live.clinicProfile = { practiceCompletedAt: now, practitionersCompletedAt: now }
        return ok(route, app)
      case 'POST /onboarding/agreement':
        if (body.confirmClinicName !== CLINIC_NAME)
          return fail(route, 400, 'validation_error', 'Confirmation name does not match')
        app.progress.agreement = true
        app.verification = { ...app.verification, submittedAt: now }
        // CTO-25: signing finishes onboarding.
        live.tenant = {
          ...live.tenant,
          termsAcceptedAt: now,
          submittedForReviewAt: now,
          onboardingCompletedAt: now,
        }
        return ok(route, {
          acceptedAt: now,
          version: 'v2-2026-11',
          verificationStatus: 'PENDING_REVIEW',
        })
      case 'GET /onboarding/status':
        return ok(route, {
          completedAt: live.tenant.onboardingCompletedAt ?? null,
          step: 0,
          termsAcceptedAt: now,
          verification: app.verification,
          application: app.progress,
          checklist: {
            brand: false,
            locations: true,
            disciplines: false,
            services: false,
            providers: false,
            availability: false,
            website: false,
          },
        })
      case 'PATCH /onboarding/step':
        live.tenant = { ...live.tenant, onboardingStep: body.step }
        return ok(route, { step: body.step })
      case 'POST /onboarding/complete':
        live.tenant = { ...live.tenant, onboardingCompletedAt: now }
        return ok(route, { completedAt: now })
      case 'GET /locations':
        return ok(route, { locations: [app.location] })
      case 'PATCH /locations/loc-1':
        app.location = { ...app.location, ...body }
        return ok(route, { location: app.location })
      default:
        return route.fallback()
    }
  }
  await page.route(`${API}/onboarding/**`, handler)
  await page.route(`${API}/locations**`, handler)
  return calls
}

test('a new clinic owner completes the application, then sets up while under review', async ({
  page,
}) => {
  const live: MockOnboarding = {
    tenant: {
      onboardingCompletedAt: null,
      termsAcceptedAt: null,
      verificationStatus: 'PENDING_REVIEW',
    },
    clinicProfile: null,
  }
  await installMockApi(page, {
    role: 'SUPER_ADMIN',
    newClinic: true,
    signedIn: true,
    onboarding: live,
  })
  const calls = await mockOnboarding(page, live)

  // The dashboard isn't reachable yet: straight to the first application step.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/practice$/)
  await expect(page.getByRole('heading', { name: 'Tell us about your practice' })).toBeVisible()
  // Later steps are locked until this one is saved.
  await page.goto('/agreement')
  await expect(page).toHaveURL(/\/practice$/)

  // ── Step 1: practice details ──
  await page.locator('#legalName').fill('Sunrise Wellness Partners LLC')
  // CTO-04: no Sales rep field. CTO-17: primary + optional secondary contact only.
  await expect(page.locator('#salesRep')).toHaveCount(0)
  await expect(page.locator('#officeManagerName')).toHaveCount(0)
  await expect(page.locator('#accountsPayableName')).toHaveCount(0)
  await expect(page.locator('#secondaryContactName')).toBeVisible()
  // CTO-18: "Other" takes a typed name; a near-miss of a listed type is offered.
  await page.locator('#practiceType').selectOption('OTHER')
  await page.locator('#practiceTypeOther').fill('longevitty')
  const suggestion = page.getByTestId('practice-type-suggestion')
  await expect(suggestion).toContainText('Longevity medical practice')
  await suggestion.getByRole('button', { name: 'Use it' }).click()
  // CTO-06: the CTO's core market is a listed type.
  await expect(page.locator('#practiceType')).toHaveValue('LONGEVITY_MEDICAL')
  await page.locator('#locationCount').fill('2')
  await page.locator('#addressLine1').fill('100 Example Street')
  await page.locator('#city').fill('Testville')
  await page.locator('#state').selectOption('TX')
  await page.locator('#postalCode').fill('75001')
  await page.locator('#timezone').selectOption('America/Chicago')
  await page.locator('#groupNpi').fill('1234567890')
  await expect(page.getByTestId('idcheck-NPI')).toHaveText(/Not a valid NPI/)
  await page.locator('#groupNpi').fill('1234567893')
  await expect(page.getByTestId('idcheck-NPI')).toHaveText(/check digit look right/)
  await page.locator('#federalTaxId').fill('12-3456789')
  // CTO-22: a ZIP outside the state is a warning only.
  await page.locator('#postalCode').fill('10001')
  await expect(page.getByTestId('zip-warning')).toBeVisible()
  await page.locator('#postalCode').fill('75001')
  await expect(page.getByTestId('zip-warning')).toHaveCount(0)
  // CTO-09: a team of one. Typing replaces the pre-filled 1 instead of making "11".
  await page.locator('#estimatedSeats').click()
  await page.keyboard.type('1')
  await expect(page.locator('#estimatedSeats')).toHaveValue('1')
  await page.locator('#secondaryContactName').fill('Sam Second')
  await page.locator('#secondaryContactEmail').fill('sam@example.test')
  await page.getByRole('button', { name: 'Save & continue' }).click()

  await expect(page).toHaveURL(/\/practitioners$/)
  const practice = calls.find((c) => c.key === 'PUT /onboarding/application/practice')!
  expect(practice.body).not.toHaveProperty('salesRep')
  expect(practice.body).not.toHaveProperty('officeManagerName')
  expect(practice.body).toMatchObject({
    legalName: 'Sunrise Wellness Partners LLC',
    practiceType: 'LONGEVITY_MEDICAL',
    practiceTypeOther: null,
    estimatedSeats: 1,
    secondaryContactName: 'Sam Second',
    secondaryContactEmail: 'sam@example.test',
    state: 'TX',
    timezone: 'America/Chicago',
    groupNpi: '1234567893',
    federalTaxId: '12-3456789',
    noNpi: false,
    dbaName: null,
  })

  // ── Step 2: practitioners (CTO-14: the owner is row 0, pre-filled, no "This is me") ──
  await expect(page.locator('#p0-name')).not.toHaveValue('')
  await expect(page.getByLabel('This is me')).toHaveCount(0)
  await expect(page.getByLabel('I see patients')).toBeChecked()
  await page.locator('#p0-title').selectOption('Medical Director')
  await page.getByRole('button', { name: 'Save & continue' }).click()
  await expect(page.getByText('NPI is required')).toBeVisible()
  await page.locator('#p0-npi').fill('1234567893')
  await page.locator('#p0-cred').fill('MD')
  await page.getByRole('button', { name: /Add practitioner/ }).click()
  await page.locator('#p1-name').fill('Nate Naturopath')
  await page.locator('#p1-email').fill('nate@example.test')
  await page.locator('#p1-npi').fill('1987654328')
  await page.getByRole('button', { name: 'Save & continue' }).click()

  await expect(page).toHaveURL(/\/agreement$/)
  const practitioners = calls.find((c) => c.key === 'PUT /onboarding/application/practitioners')!
  expect(practitioners.body.practitioners).toEqual([
    expect.objectContaining({
      npi: '1234567893',
      credentials: 'MD',
      title: 'Medical Director',
      isOwner: true,
      isSelf: true,
      seesPatients: true,
    }),
    expect.objectContaining({ name: 'Nate Naturopath', isOwner: false, isSelf: false }),
  ])

  // ── Step 3: agreement — summary, acknowledgements, typed signature ──
  const summary = page.getByRole('region', { name: 'Application summary' })
  await expect(summary).toContainText('Sunrise Wellness Partners LLC')
  await expect(summary).toContainText('•••••6789')
  await expect(summary).not.toContainText('12-3456789')
  const submit = page.getByRole('button', { name: /Sign & submit application/ })
  await expect(submit).toBeDisabled()
  // CTO-08: one click on "select all" ticks every acknowledgement.
  await page.getByLabel('I agree to all of the above').check()
  await page.getByLabel(/read and agree to the authorization/).check()
  // CTO-16: the signer's title is pre-filled from their practitioner row.
  await expect(page.locator('#signerTitle')).toHaveValue('Medical Director')
  const printed = await page.locator('#signerName').inputValue()
  await page.locator('#signature').fill('Someone Else')
  await expect(page.getByText('Type your name exactly as printed')).toBeVisible()
  await expect(submit).toBeDisabled()
  await page.locator('#signature').fill(printed.toLowerCase())
  await submit.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Clinic name').fill(CLINIC_NAME)
  await dialog.getByRole('button', { name: 'Confirm & submit' }).click()

  // CTO-25: straight to the dashboard, in review, with Quick setup there.
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByTestId('verification-banner')).toContainText('Your clinic is under review')
  const agreement = calls.find((c) => c.key === 'POST /onboarding/agreement')!
  expect(agreement.body).toMatchObject({
    communications: true,
    signerTitle: 'Medical Director',
    confirmClinicName: CLINIC_NAME,
    acknowledgements: {
      baa: true,
      hipaa: true,
      dataResidency: true,
      refundPolicy: true,
      authorizedSignatory: true,
    },
  })
  // No setup wizard: no step was saved and onboarding was never "completed" by hand.
  expect(calls.some((c) => c.key === 'PATCH /onboarding/step')).toBe(false)
  expect(calls.some((c) => c.key === 'POST /onboarding/complete')).toBe(false)
  // The application and the old wizard are closed once signed.
  await page.goto('/practice')
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/brand')
  await expect(page).toHaveURL(/\/dashboard/)

  // ── Command Center: Quick setup, the website optional ──
  await page.goto('/dashboard/admin')
  const checklist = page.getByTestId('setup-checklist')
  await expect(checklist).toContainText('Quick setup')
  await expect(checklist).toContainText('Clinic approved by MedoFlow')
  await expect(checklist.getByRole('link', { name: /Publish your website/ })).toContainText(
    'Optional'
  )
  await expect(checklist.getByRole('link', { name: /Add bookable services/ })).toHaveAttribute(
    'href',
    '/dashboard/services'
  )
})

test('changes requested: the owner sees the note and resubmits from the clinic profile', async ({
  page,
}) => {
  const live: MockOnboarding = {
    tenant: {
      onboardingCompletedAt: '2026-11-10T00:00:00.000Z',
      termsAcceptedAt: '2026-11-10T00:00:00.000Z',
      verificationStatus: 'CHANGES_REQUESTED',
      reviewNotes: 'The group NPI does not match the legal name.',
    },
    clinicProfile: {
      practiceCompletedAt: '2026-11-10T00:00:00.000Z',
      practitionersCompletedAt: '2026-11-10T00:00:00.000Z',
    },
  }
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true, onboarding: live })
  let resubmitted = false
  await page.route(`${API}/onboarding/**`, async (route) => {
    const key = `${route.request().method()} ${new URL(route.request().url()).pathname.replace(/^\/api\/v1/, '')}`
    if (key === 'GET /onboarding/application') {
      return ok(route, {
        clinicName: CLINIC_NAME,
        verification: {
          status: resubmitted ? 'PENDING_REVIEW' : 'CHANGES_REQUESTED',
          submittedAt: '2026-11-10T00:00:00.000Z',
          reviewedAt: null,
          notes: 'The group NPI does not match the legal name.',
        },
        progress: { practice: true, practitioners: true, agreement: true },
        profile: null,
        location: null,
        agreement: {
          version: 'v2-2026-11',
          signerName: 'Ada Stone',
          signerTitle: 'Owner',
          communicationsConsent: true,
          acceptedAt: '2026-11-10T00:00:00.000Z',
        },
      })
    }
    if (key === 'POST /onboarding/application/resubmit') {
      resubmitted = true
      live.tenant = {
        ...live.tenant,
        verificationStatus: 'PENDING_REVIEW',
        submittedForReviewAt: 'x',
      }
      return ok(route, { verificationStatus: 'PENDING_REVIEW', submittedAt: 'x' })
    }
    return route.fallback()
  })

  await page.goto('/dashboard/admin')
  const banner = page.getByTestId('verification-banner')
  await expect(banner).toContainText('The group NPI does not match the legal name.')
  await banner.getByRole('link', { name: 'Update application' }).click()
  await expect(page).toHaveURL(/\/dashboard\/clinic$/)
  await expect(page.getByTestId('clinic-review-status')).toContainText('Changes requested')
  await expect(page.getByTestId('clinic-review-status')).toContainText('signed by Ada Stone')
  await page.getByRole('button', { name: 'Resubmit for review' }).click()
  await expect(page.getByTestId('clinic-review-status')).toContainText('Under review')
  await expect(page.getByTestId('verification-banner')).toContainText('under review')
})

test('platform admin: review queue → application → request changes → approve', async ({ page }) => {
  await installMockApi(page, { role: 'PLATFORM_ADMIN', signedIn: true })
  let status = 'PENDING_REVIEW'
  const decisions: Record<string, unknown>[] = []
  const detail = () => ({
    id: 'tenant-review',
    name: 'Sunrise Wellness',
    slug: 'sunrise',
    status: 'TRIAL',
    plan: 'GROWTH',
    trialEndsAt: null,
    termsAcceptedAt: '2026-11-10T00:00:00.000Z',
    termsVersion: 'v2-2026-11',
    onboardingCompletedAt: null,
    onboardingStep: 2,
    verificationStatus: status,
    submittedForReviewAt: '2026-11-10T00:00:00.000Z',
    reviewedAt: null,
    reviewNotes: null,
    createdAt: '2026-11-10T00:00:00.000Z',
    brand: { subdomain: 'sunrise', customDomain: null, primaryColor: '#6366f1', logoUrl: null },
    clinics: [
      {
        id: 'c1',
        name: 'Sunrise Wellness',
        email: 'hello@example.test',
        isActive: true,
        _count: { providers: 0, locations: 1, users: 1 },
      },
    ],
    application: {
      clinicId: 'c1',
      owner: { id: 'u1', name: 'Ada Stone', email: 'ada@example.test', createdAt: '2026-11-10' },
      profile: {
        legalName: 'Sunrise Wellness Partners LLC',
        dbaName: null,
        practiceType: 'FUNCTIONAL_MEDICINE',
        locationCount: 1,
        officePhone: null,
        fax: null,
        website: null,
        primaryContactName: 'Ada Stone',
        primaryContactEmail: 'ada@example.test',
        primaryContactPhone: null,
        secondaryContactName: null,
        secondaryContactEmail: null,
        secondaryContactPhone: null,
        mailingSameAsPrimary: true,
        mailingAddressLine1: null,
        mailingCity: null,
        mailingState: null,
        mailingPostalCode: null,
        groupNpi: '1234567893',
        noNpi: false,
        federalTaxId: '12-3456789',
        licenseNumber: 'TX-1',
        licenseState: 'TX',
        deaNumber: 'AB1234564',
        estimatedSeats: 3,
        referralSource: null,
        practitioners: [
          {
            name: 'Ada Stone',
            email: 'ada@example.test',
            npi: '1234567893',
            isOwner: true,
            isSelf: true,
          },
        ],
      },
      location: {
        addressLine1: '1 Main St',
        addressLine2: null,
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        timezone: 'America/Chicago',
      },
      agreements: [
        {
          id: 'a1',
          version: 'v2-2026-11',
          signerName: 'Ada Stone',
          signerTitle: 'Owner',
          signatureText: 'Ada Stone',
          communicationsConsent: true,
          ipAddress: '203.0.113.7',
          acceptedAt: '2026-11-10T00:00:00.000Z',
        },
      ],
    },
  })
  await page.route(`${API}/platform/clinics**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
    if (req.method() === 'GET' && path === '/platform/clinics') {
      const d = detail()
      const items = [{ ...d, clinics: d.clinics }]
      const filtered = url.searchParams.get('verification')
        ? items.filter((i) => i.verificationStatus === url.searchParams.get('verification'))
        : items
      return ok(route, {
        items: filtered,
        total: filtered.length,
        pendingReview: status === 'PENDING_REVIEW' ? 1 : 0,
      })
    }
    if (req.method() === 'GET' && path === '/platform/clinics/tenant-review')
      return ok(route, detail())
    if (req.method() === 'POST' && path === '/platform/clinics/tenant-review/review') {
      const body = req.postDataJSON() as { decision: string; notes?: string }
      decisions.push(body)
      status = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', REJECT: 'REJECTED' }[
        body.decision
      ]!
      return ok(route, { verificationStatus: status, changed: true })
    }
    return route.fallback()
  })

  await page.goto('/platform/clinics')
  await expect(page.getByTestId('review-queue')).toContainText('1 clinic application is waiting')
  await page.getByTestId('review-queue').click()
  await page.getByRole('link', { name: 'Sunrise Wellness' }).click()
  await expect(page).toHaveURL(/\/platform\/clinics\/tenant-review$/)

  const review = page.getByTestId('application-review')
  await expect(review).toContainText('Sunrise Wellness Partners LLC')
  await expect(review).toContainText('12-3456789') // full numbers for the reviewer
  // Format checks: the NPI and EIN pass, the DEA's check digit is wrong.
  await expect(review.getByText('checksum ok').first()).toBeVisible()
  await expect(review.getByText('invalid')).toBeVisible()
  await expect(review).toContainText('from 203.0.113.7')

  const requestChanges = review.getByRole('button', { name: 'Request changes' })
  await expect(requestChanges).toBeDisabled() // needs a note
  await review.getByLabel('Note to the clinic').fill('The DEA number does not verify.')
  await requestChanges.click()
  await expect(page.getByText('Changes requested').first()).toBeVisible()
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Approved — live')).toBeVisible()
  expect(decisions).toEqual([
    { decision: 'REQUEST_CHANGES', notes: 'The DEA number does not verify.' },
    { decision: 'APPROVE' },
  ])
})

// CTO-05: the "Your account" fields line up on desktop and stack on a phone.
for (const [name, width, height] of [
  ['desktop', 1280, 900],
  ['mobile', 375, 800],
] as const) {
  test(`"Your account" layout (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const live: MockOnboarding = {
      tenant: {
        onboardingCompletedAt: null,
        termsAcceptedAt: null,
        verificationStatus: 'PENDING_REVIEW',
      },
      clinicProfile: null,
    }
    await installMockApi(page, {
      role: 'SUPER_ADMIN',
      newClinic: true,
      signedIn: true,
      onboarding: live,
    })
    await mockOnboarding(page, live)
    await page.goto('/practice')
    const seats = page.locator('#estimatedSeats')
    const referral = page.locator('#referralSource')
    await seats.scrollIntoViewIfNeeded()
    const a = (await seats.boundingBox())!
    const b = (await referral.boundingBox())!
    if (name === 'desktop') {
      // Same row, same top edge: label and input share a baseline.
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1)
      expect(b.x).toBeGreaterThan(a.x)
    } else {
      expect(b.y).toBeGreaterThan(a.y + a.height) // stacked
    }
    await page
      .getByRole('heading', { name: 'Your account' })
      .locator('xpath=ancestor::section[1]')
      .screenshot({ path: `test-results/cto-05-your-account-${name}.png` })
  })
}
