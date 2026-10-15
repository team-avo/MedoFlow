import assert from 'node:assert/strict'
import prisma from '../config/prisma'
import stripe from '../config/stripe'
import * as aiScribeService from '../services/aiScribeService'
import * as consultationService from '../services/consultationService'
import * as paymentService from '../services/paymentService'
import * as appointmentController from '../controllers/appointmentController'
import * as appointmentService from '../services/appointmentService'
import * as visitService from '../services/visitService'
import * as openaiService from '../services/openaiService'
import * as auditService from '../services/auditService'

// Module namespace exports are getter-only; redefine instead of assigning.
const restore = <T extends object, K extends keyof T>(object: T, key: K, value: T[K]) => {
  Object.defineProperty(object, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

test('approving a note finalizes it without auto-publishing patient summary', async () => {
  const originalFindFirst = prisma.aIScribeSession.findFirst
  const originalFindUnique = prisma.aIScribeSession.findUnique
  const originalTransaction = prisma.$transaction
  const originalGetProvider = visitService.getProviderByUserId
  const originalGenerateSummary = openaiService.generatePatientSummary
  const originalLogAudit = auditService.logAudit

  let updatedAiSessionData: Record<string, unknown> | null = null

  try {
    ;(prisma.aIScribeSession.findFirst as any) = async () => ({
      id: 'session-1',
      visitRecordId: 'visit-1',
      providerId: 'provider-1',
      clinicId: 'clinic-1',
      status: 'DRAFT_GENERATED',
      aiDraft: {
        subjective: 'S',
        objective: 'O',
        assessment: 'A',
        plan: 'P',
      },
      visitRecord: {
        id: 'visit-1',
        appointmentId: 'appointment-1',
        patientId: 'patient-1',
        isFinalized: false,
        currentVersion: null,
      },
      provider: { userId: 'user-1' },
    })
    restore(visitService, 'getProviderByUserId', (async () => ({ id: 'provider-1' })) as any)
    restore(openaiService, 'generatePatientSummary', (async () => ({
      diagnosis: 'Dx',
      treatmentPlan: 'Tx',
      nextSteps: 'Nx',
    })) as any)
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<void>) =>
      callback({
        visitNoteVersion: {
          create: async () => ({ id: 'version-1' }),
        },
        visitRecord: {
          update: async () => ({ id: 'visit-1' }),
        },
        aIScribeSession: {
          update: async ({ data }: { data: Record<string, unknown> }) => {
            updatedAiSessionData = data
            return { id: 'session-1' }
          },
        },
      })
    ;(prisma.aIScribeSession.findUnique as any) = async () => ({
      id: 'session-1',
      status: 'APPROVED',
      patientSummaryPublished: false,
      visitRecord: {
        id: 'visit-1',
        isFinalized: true,
        currentVersion: { id: 'version-1' },
      },
    })
    restore(auditService, 'logAudit', (async () => {}) as any)

    const session = await aiScribeService.approveDraft(
      'session-1',
      'provider-1',
      'clinic-1',
      'user-1'
    )

    assert.equal((updatedAiSessionData as any)?.patientSummaryPublished, false)
    assert.equal((session as any)?.patientSummaryPublished, false)
  } finally {
    restore(prisma.aIScribeSession, 'findFirst', originalFindFirst)
    restore(prisma.aIScribeSession, 'findUnique', originalFindUnique)
    restore(prisma, '$transaction', originalTransaction)
    restore(visitService, 'getProviderByUserId', originalGetProvider)
    restore(openaiService, 'generatePatientSummary', originalGenerateSummary)
    restore(auditService, 'logAudit', originalLogAudit)
  }
})

test('explicit publish is still required before patient summary becomes visible', async () => {
  const originalFindFirst = prisma.aIScribeSession.findFirst
  const originalUpdate = prisma.aIScribeSession.update
  const originalFindUnique = prisma.aIScribeSession.findUnique
  const originalLogAudit = auditService.logAudit

  let publishedFlag: boolean | null = null
  let publishedQuery: Record<string, unknown> | null = null

  try {
    ;(prisma.aIScribeSession.findFirst as any) = async ({
      where,
    }: {
      where: Record<string, unknown>
    }) => {
      publishedQuery = where
      return {
        id: 'session-1',
        visitRecordId: 'visit-1',
        providerId: 'provider-1',
        clinicId: 'clinic-1',
        status: 'APPROVED',
        patientSummary: { diagnosis: 'Dx' },
        patientSummaryPublished: false,
        visitRecord: {
          id: 'visit-1',
          appointmentId: 'appointment-1',
          patientId: 'patient-1',
          isFinalized: true,
          currentVersion: null,
        },
        provider: { userId: 'user-1' },
      }
    }
    ;(prisma.aIScribeSession.update as any) = async ({
      data,
    }: {
      data: Record<string, unknown>
    }) => {
      publishedFlag = Boolean(data.patientSummaryPublished)
      return { id: 'session-1' }
    }
    ;(prisma.aIScribeSession.findUnique as any) = async () => ({
      id: 'session-1',
      patientSummaryPublished: true,
      visitRecord: { id: 'visit-1' },
    })
    restore(auditService, 'logAudit', (async () => {}) as any)

    const published = await aiScribeService.publishPatientSummary(
      'session-1',
      'provider-1',
      'clinic-1',
      'user-1'
    )

    assert.equal(publishedFlag, true)
    assert.equal((published as any)?.patientSummaryPublished, true)

    await aiScribeService.getPublishedPatientSummary('visit-1', 'patient-1')
    assert.equal((publishedQuery as any)?.patientSummaryPublished, true)
  } finally {
    restore(prisma.aIScribeSession, 'findFirst', originalFindFirst)
    restore(prisma.aIScribeSession, 'update', originalUpdate)
    restore(prisma.aIScribeSession, 'findUnique', originalFindUnique)
    restore(auditService, 'logAudit', originalLogAudit)
  }
})

test('expired consultation join token is rejected safely', async () => {
  const originalFindUnique = prisma.consultationSession.findUnique

  try {
    ;(prisma.consultationSession.findUnique as any) = async () => ({
      id: 'session-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      joinToken: 'expired-token',
      joinTokenExpiresAt: new Date(Date.now() - 60_000),
      appointment: {
        id: 'appointment-1',
        startTime: new Date(),
        endTime: new Date(),
        status: 'CONFIRMED',
        meetLink: null,
      },
      provider: { firstName: 'Abhinav', lastName: 'Verma' },
      patient: { id: 'patient-1', name: 'Patient One' },
    })

    await assert.rejects(
      () => consultationService.getSessionByToken('expired-token'),
      (err: any) =>
        err?.statusCode === 410 && err?.code === 'token_expired' && /expired/i.test(err?.message)
    )
  } finally {
    restore(prisma.consultationSession, 'findUnique', originalFindUnique)
  }
})

test('expired consultation token is rotated when session is reopened', async () => {
  const originalAppointmentFindFirst = prisma.appointment.findFirst
  const originalSessionFindFirst = prisma.consultationSession.findFirst
  const originalSessionUpdate = prisma.consultationSession.update

  let rotatedToken: string | null = null
  let rotatedExpiry: Date | null = null

  try {
    ;(prisma.appointment.findFirst as any) = async () => ({
      id: 'appointment-1',
      clinicId: 'clinic-1',
      providerId: 'provider-1',
      patientId: 'patient-1',
      status: 'CONFIRMED',
    })
    ;(prisma.consultationSession.findFirst as any) = async () => ({
      id: 'session-1',
      clinicId: 'clinic-1',
      appointmentId: 'appointment-1',
      providerId: 'provider-1',
      patientId: 'patient-1',
      joinToken: 'old-token',
      joinTokenExpiresAt: new Date(Date.now() - 60_000),
      appointment: {
        id: 'appointment-1',
        startTime: new Date(),
        endTime: new Date(),
        meetLink: null,
      },
    })
    ;(prisma.consultationSession.update as any) = async ({
      data,
    }: {
      data: { joinToken: string; joinTokenExpiresAt: Date }
    }) => {
      rotatedToken = data.joinToken
      rotatedExpiry = data.joinTokenExpiresAt
      return {
        id: 'session-1',
        joinToken: data.joinToken,
        joinTokenExpiresAt: data.joinTokenExpiresAt,
        appointment: {
          id: 'appointment-1',
          startTime: new Date(),
          endTime: new Date(),
          meetLink: null,
        },
      }
    }

    const session = await consultationService.createOrGetSession(
      'appointment-1',
      'provider-1',
      'clinic-1',
      'user-1'
    )

    assert.ok(rotatedToken)
    assert.notEqual(rotatedToken, 'old-token')
    assert.ok(Boolean(rotatedExpiry))
    assert.ok((rotatedExpiry as unknown as Date).getTime() > Date.now())
    assert.equal(session.joinToken, rotatedToken)
  } finally {
    restore(prisma.appointment, 'findFirst', originalAppointmentFindFirst)
    restore(prisma.consultationSession, 'findFirst', originalSessionFindFirst)
    restore(prisma.consultationSession, 'update', originalSessionUpdate)
  }
})

test('explicit payment intent creation is idempotent when a pending intent already exists', async () => {
  const originalAppointmentFindFirst = prisma.appointment.findFirst
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalStripeCreate = stripe.paymentIntents.create

  let stripeCreateCalls = 0

  try {
    ;(prisma.appointment.findFirst as any) = async () => ({
      id: 'appointment-1',
      clinicId: 'clinic-1',
      providerId: 'provider-1',
      patientId: 'patient-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      paymentRequirementType: 'FULL',
      depositAmount: null,
      priceAtBooking: { toString: () => '120.00' },
      bookingHoldExpiresAt: new Date(Date.now() + 60_000),
    })
    ;(prisma.payment.findFirst as any) = async () => ({
      id: 'payment-1',
      stripeClientSecret: 'pi_secret_existing',
      stripePaymentIntentId: 'pi_existing',
      createdAt: new Date(),
    })
    ;(stripe.paymentIntents.create as any) = async () => {
      stripeCreateCalls += 1
      return { id: 'pi_new', client_secret: 'pi_secret_new' }
    }

    const result = await paymentService.ensurePaymentIntent('appointment-1', 'patient-1', {
      patientId: 'patient-1',
    })

    assert.equal(result.clientSecret, 'pi_secret_existing')
    assert.equal(result.reused, true)
    assert.equal(stripeCreateCalls, 0)
  } finally {
    restore(prisma.appointment, 'findFirst', originalAppointmentFindFirst)
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(stripe.paymentIntents, 'create', originalStripeCreate)
  }
})

test('explicit payment intent creation creates a pending payment when none exists', async () => {
  const originalAppointmentFindFirst = prisma.appointment.findFirst
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalPaymentCreate = prisma.payment.create
  const originalLogAudit = auditService.logAudit
  const originalStripeCreate = stripe.paymentIntents.create

  let createdPaymentData: Record<string, unknown> | null = null

  try {
    ;(prisma.appointment.findFirst as any) = async () => ({
      id: 'appointment-1',
      clinicId: 'clinic-1',
      providerId: 'provider-1',
      patientId: 'patient-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      paymentRequirementType: 'FULL',
      depositAmount: null,
      priceAtBooking: { toString: () => '120.00' },
      bookingHoldExpiresAt: new Date(Date.now() + 60_000),
    })
    ;(prisma.payment.findFirst as any) = async () => null
    ;(prisma.payment.create as any) = async ({ data }: { data: Record<string, unknown> }) => {
      createdPaymentData = data
      return { id: 'payment-1', ...data }
    }
    ;(stripe.paymentIntents.create as any) = async () => ({
      id: 'pi_created',
      client_secret: 'pi_secret_created',
    })
    restore(auditService, 'logAudit', (async () => {}) as any)

    const result = await paymentService.ensurePaymentIntent('appointment-1', 'patient-1', {
      patientId: 'patient-1',
    })

    assert.equal(result.clientSecret, 'pi_secret_created')
    assert.equal(result.reused, false)
    assert.equal((createdPaymentData as any)?.status, 'PENDING')
    assert.equal((createdPaymentData as any)?.stripePaymentIntentId, 'pi_created')
  } finally {
    restore(prisma.appointment, 'findFirst', originalAppointmentFindFirst)
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(prisma.payment, 'create', originalPaymentCreate)
    restore(auditService, 'logAudit', originalLogAudit)
    restore(stripe.paymentIntents, 'create', originalStripeCreate)
  }
})

test('appointment detail read no longer injects a payment client secret', async () => {
  const originalGetAppointmentById = appointmentService.getAppointmentById
  const originalFindEvent = prisma.googleCalendarEvent.findFirst

  const responsePayload: { appointment?: Record<string, unknown> } = {}
  const req = {
    params: { id: 'appointment-1' },
    user: { id: 'patient-1', role: 'PATIENT' },
    clinicId: null,
  } as any
  const res = {
    status(code: number) {
      assert.equal(code, 200)
      return this
    },
    json(payload: { data?: { appointment?: Record<string, unknown> } }) {
      responsePayload.appointment = payload.data?.appointment
      return this
    },
  } as any

  try {
    restore(appointmentService, 'getAppointmentById', (async () => ({
      id: 'appointment-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      providerId: 'provider-1',
      serviceId: 'service-1',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      paymentRequirementType: 'FULL',
      depositAmount: null,
      priceAtBooking: '120.00',
      provider: { firstName: 'Abhinav', lastName: 'Verma' },
      service: { name: 'Consultation' },
    })) as any)
    ;(prisma.googleCalendarEvent.findFirst as any) = async () => ({ meetLink: null })

    // asyncHandler returns void; let the wrapped handler settle before asserting.
    let nextErr: unknown
    appointmentController.getById(req, res, (err?: unknown) => {
      nextErr = err
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.ifError(nextErr)

    assert.equal(responsePayload.appointment?.clientSecret, undefined)
  } finally {
    restore(appointmentService, 'getAppointmentById', originalGetAppointmentById)
    restore(prisma.googleCalendarEvent, 'findFirst', originalFindEvent)
  }
})
