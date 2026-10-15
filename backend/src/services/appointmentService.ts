import prisma from '../config/prisma'
import type { Request } from 'express'
import type { ApiError } from '../types/errors'
import {
  AppointmentStatus,
  ApprovalStatus,
  BookingSource,
  PaymentRequirementType,
  PaymentStatus,
  Prisma,
} from '@prisma/client'
import * as auditService from './auditService'
import * as waitlistService from './waitlistService'
import * as packageUsageService from './packageUsageService'
import * as membershipService from './membershipService'
import { MIN_APPOINTMENT_DURATION_MINUTES, resolveAppointmentLifecycle } from './schedulingCore'

import stripe from '../config/stripe'
import {
  clinicScope,
  getAllowedClinicIds,
  getTenantContext,
  withTenantContext,
} from '../config/tenantContext'

import * as emailService from './emailService'

const ZERO = new Prisma.Decimal(0)

export interface CreateAppointmentData {
  locationId?: string | null
  providerId: string
  serviceId: string
  patientId: string
  startTime: string | Date
  endTime: string | Date
  /**
   * Patient AI-Scribe consent captured at booking time. When true, the
   * appointment is stamped with `aiScribeConsentGrantedAt = now()` and the
   * consultation session will start with consent already granted.
   */
  aiScribeConsent?: boolean
}

export interface CreateAppointmentContext {
  performedById?: string
  excludeAppointmentId?: string
  /** Optional slot hold ID - when provided, validates and consumes hold to prevent race conditions */
  slotHoldId?: string
  bookingSource?: BookingSource
  recurringSeriesId?: string | null
  notes?: string | null
  patientPackageId?: string
  skipPackageSessionConsumption?: boolean
}

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.DRAFT,
  AppointmentStatus.PENDING_PROVIDER_APPROVAL,
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
]

const createApiError = (message: string, statusCode: number, code: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  err.code = code
  return err
}

const validateAppointmentWindow = (startTime: Date, endTime: Date) => {
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    throw createApiError('Start time and end time must be valid dates', 400, 'validation_error')
  }

  const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000
  if (durationMinutes <= 0) {
    throw createApiError('End time must be after start time', 400, 'validation_error')
  }

  if (durationMinutes < MIN_APPOINTMENT_DURATION_MINUTES) {
    throw createApiError(
      `Appointments must be at least ${MIN_APPOINTMENT_DURATION_MINUTES} minutes long`,
      400,
      'validation_error'
    )
  }
}

// Only $executeRaw is needed (pure raw SQL: pg_advisory_xact_lock), so the
// tx is typed structurally rather than as the full TransactionClient.
const lockBookingScope = async (
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  providerId: string,
  patientId: string
) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointment-provider:${providerId}`}))`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointment-patient:${patientId}`}))`
}

const checkMinimumNotice = (
  startTime: Date,
  minimumNoticeMinutes: number,
  _clinicId: string,
  _serviceId: string,
  _performedById: string | undefined
): void => {
  if (minimumNoticeMinutes <= 0) return
  const now = new Date()
  const diffMinutes = (startTime.getTime() - now.getTime()) / (1000 * 60)
  if (diffMinutes < minimumNoticeMinutes) {
    const hours = Math.ceil(minimumNoticeMinutes / 60)
    const err = new Error(
      `This service requires at least ${hours} hour${hours !== 1 ? 's' : ''} notice.`
    ) as ApiError
    err.statusCode = 400
    throw err
  }
}

const checkMaxFutureBooking = (
  startTime: Date,
  maxFutureBookingDays: number,
  _clinicId: string,
  _serviceId: string,
  _performedById: string | undefined
): void => {
  const now = new Date()
  const maxDate = new Date(now)
  maxDate.setDate(maxDate.getDate() + maxFutureBookingDays)
  maxDate.setHours(23, 59, 59, 999)
  if (startTime > maxDate) {
    const err = new Error(
      `Appointments cannot be booked more than ${maxFutureBookingDays} days in advance.`
    ) as ApiError
    err.statusCode = 400
    throw err
  }
}

// A patient booking at a clinic they are not yet a member of: the booking
// upserts their PatientClinicMembership for that clinic, so the booking runs
// with exactly that one clinic added to the caller's scope (tenant guard and
// RLS), instead of a bypass. Staff, other patients' bookings and bypass
// scopes are left untouched.
const withPatientSelfEnrollScope = <T>(clinicId: string, patientId: string, fn: () => T): T => {
  const ctx = getTenantContext()
  if (!ctx || ctx.bypassReason || ctx.role !== 'PATIENT' || ctx.userId !== patientId) return fn()
  const allowed = getAllowedClinicIds(ctx)
  if (allowed.includes(clinicId)) return fn()
  return withTenantContext({ ...ctx, allowedClinicIds: [...allowed, clinicId] }, fn)
}

export const createAppointment = async (
  data: CreateAppointmentData,
  clinicId: string,
  context?: CreateAppointmentContext
) => {
  const { locationId, providerId, serviceId, patientId, startTime, endTime } = data

  const performedById = context?.performedById
  const excludeAppointmentId = context?.excludeAppointmentId ?? null
  const slotHoldId = context?.slotHoldId
  const bookingSource = context?.bookingSource ?? BookingSource.PUBLIC
  const startDate = new Date(startTime)
  const endDate = new Date(endTime)

  validateAppointmentWindow(startDate, endDate)

  return withPatientSelfEnrollScope(clinicId, patientId, () =>
    prisma.$transaction(async (tx) => {
      await lockBookingScope(tx, providerId, patientId)

      if (slotHoldId) {
        const hold = await tx.slotHold.findFirst({
          where: { id: slotHoldId, clinicId, status: 'ACTIVE' },
        })
        if (!hold) {
          throw createApiError(
            'Slot hold expired or invalid. Please select the slot again.',
            400,
            'expired_hold'
          )
        }
        if (hold.expiresAt < new Date()) {
          await tx.slotHold.update({
            where: { id: hold.id, clinicId },
            data: {
              status: 'EXPIRED',
              expiredAt: new Date(),
            },
          })
          throw createApiError(
            'Slot hold expired or invalid. Please select the slot again.',
            400,
            'expired_hold'
          )
        }
        if (
          hold.providerId !== providerId ||
          hold.serviceId !== serviceId ||
          (hold.locationId ?? null) !== (locationId ?? null) ||
          hold.startTime.getTime() !== startDate.getTime() ||
          hold.endTime.getTime() !== endDate.getTime()
        ) {
          throw createApiError('Slot hold does not match booking details', 400, 'invalid_slot')
        }

        await tx.slotHold.update({
          where: { id: slotHoldId, clinicId },
          data: { status: 'CONVERTED' },
        })
      }

      const service = await tx.service.findFirst({
        where: { id: serviceId, clinicId },
        include: { discipline: { select: { isArchived: true } } },
      })
      if (!service) {
        throw createApiError(
          'Service not found or does not belong to this clinic',
          404,
          'validation_error'
        )
      }
      if (!service.isActive || service.isArchived || service.discipline?.isArchived) {
        throw createApiError(
          'This service is not currently available for booking.',
          400,
          'validation_error'
        )
      }

      const provider = await tx.provider.findFirst({
        where: { id: providerId, clinicId, isActive: true },
        include: {
          providerServices: {
            where: { serviceId },
            include: { service: true },
          },
        },
      })
      if (!provider) {
        throw createApiError(
          'Provider not found or does not belong to this clinic',
          404,
          'validation_error'
        )
      }
      const assignment = provider.providerServices[0]
      if (!assignment) {
        throw createApiError('Provider does not offer this service', 400, 'validation_error')
      }

      const resolvedLocation =
        (locationId
          ? await tx.location.findFirst({
              where: { id: locationId, clinicId, isActive: true },
            })
          : await tx.location.findFirst({
              where: { clinicId, isActive: true },
              orderBy: { createdAt: 'asc' },
            })) ?? null

      if (!resolvedLocation) {
        throw createApiError(
          'Location not found or does not belong to this clinic',
          404,
          'validation_error'
        )
      }

      const providerAtLocation = await tx.providerLocationAssignment.findFirst({
        where: {
          providerId,
          locationId: resolvedLocation.id,
        },
      })
      if (!providerAtLocation) {
        throw createApiError(
          'Provider is not assigned to the selected location',
          400,
          'validation_error'
        )
      }

      const user = await tx.user.findUnique({
        where: { id: patientId },
      })
      if (!user) {
        throw createApiError('Patient not found', 404, 'validation_error')
      }
      if (user.role !== 'PATIENT') {
        throw createApiError('User is not a patient', 400, 'validation_error')
      }

      await tx.patientClinicMembership.upsert({
        where: {
          clinicId_patientId: {
            clinicId,
            patientId,
          },
        },
        create: {
          clinicId,
          patientId,
          primaryLocationId: resolvedLocation.id,
          isActive: true,
        },
        update: {
          isActive: true,
          primaryLocationId: resolvedLocation.id,
        },
      })

      const samePatientConflict = await tx.appointment.findFirst({
        where: {
          patientId,
          ...clinicScope(),
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          startTime: { lt: endDate },
          endTime: { gt: startDate },
          ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
        },
      })
      if (samePatientConflict) {
        if (performedById) {
          await tx.auditLog.create({
            data: {
              clinicId,
              entityType: 'Booking',
              entityId: serviceId,
              action: 'BOOKING_REJECTED_POLICY',
              fieldChanged: 'reason',
              newValue:
                'You already have another appointment during this time.' as Prisma.InputJsonValue,
              oldValue: Prisma.JsonNull,
              performedById,
            },
          })
        }
        throw createApiError(
          'You already have another appointment during this time.',
          409,
          'conflict'
        )
      }

      const minNotice = service.minimumNoticeMinutes ?? 0
      const maxFuture = service.maxFutureBookingDays ?? 365

      try {
        checkMinimumNotice(startDate, minNotice, clinicId, serviceId, performedById)
      } catch (err) {
        if (performedById) {
          await tx.auditLog.create({
            data: {
              clinicId,
              entityType: 'Booking',
              entityId: serviceId,
              action: 'BOOKING_REJECTED_POLICY',
              fieldChanged: 'reason',
              newValue: (err as Error).message as unknown as Prisma.InputJsonValue,
              oldValue: Prisma.JsonNull,
              performedById,
            },
          })
        }
        throw err
      }

      try {
        checkMaxFutureBooking(startDate, maxFuture, clinicId, serviceId, performedById)
      } catch (err) {
        if (performedById) {
          await tx.auditLog.create({
            data: {
              clinicId,
              entityType: 'Booking',
              entityId: serviceId,
              action: 'BOOKING_REJECTED_POLICY',
              fieldChanged: 'reason',
              newValue: (err as Error).message as unknown as Prisma.InputJsonValue,
              oldValue: Prisma.JsonNull,
              performedById,
            },
          })
        }
        throw err
      }

      const doubleBookConflict = await tx.appointment.findFirst({
        where: {
          providerId,
          clinicId,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          startTime: { lt: endDate },
          endTime: { gt: startDate },
          ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
        },
      })
      if (doubleBookConflict) {
        throw createApiError(
          'Provider has a conflicting appointment in this time slot',
          409,
          'conflict'
        )
      }

      const activeHoldConflict = await tx.slotHold.findFirst({
        where: {
          providerId,
          clinicId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          startTime: { lt: endDate },
          endTime: { gt: startDate },
          ...(slotHoldId ? { id: { not: slotHoldId } } : {}),
        },
      })
      if (activeHoldConflict) {
        throw createApiError(
          'This slot is temporarily reserved. Please choose another slot.',
          409,
          'conflict'
        )
      }

      const standardPriceAtBooking = assignment.priceOverride ?? assignment.service.defaultPrice

      // Check for package usage
      let usingPackage = false
      if (context?.patientPackageId) {
        const pkg = await tx.patientPackage.findFirst({
          where: {
            id: context.patientPackageId,
            patientId,
            clinicId,
            status: 'ACTIVE',
          },
        })
        if (pkg && pkg.usedSessions < pkg.totalSessions) {
          usingPackage = true
        } else {
          throw createApiError(
            'Selected package is not available or exhausted',
            400,
            'invalid_package'
          )
        }
      }

      let membershipBenefit = null
      if (!usingPackage) {
        try {
          membershipBenefit = await membershipService.getActiveMembershipBenefitWithExecutor(
            tx,
            clinicId,
            patientId
          )
        } catch (err) {
          console.error(
            'Demo Warning: Failed to fetch membership benefits, proceeding without discount.',
            err
          )
        }
      }

      const membershipDiscountPercent = membershipBenefit
        ? new Prisma.Decimal(membershipBenefit.membership.serviceDiscountPercent)
        : ZERO
      const membershipDiscountAmount = membershipBenefit
        ? standardPriceAtBooking.mul(membershipDiscountPercent).div(100).toDecimalPlaces(2)
        : ZERO
      const discountedPriceAtBooking = membershipBenefit
        ? standardPriceAtBooking.minus(membershipDiscountAmount).toDecimalPlaces(2)
        : standardPriceAtBooking
      const priceAtBooking = usingPackage ? ZERO : discountedPriceAtBooking

      const paymentRequirementType = usingPackage
        ? PaymentRequirementType.NONE
        : service.requirePrepayment && service.prepaymentType === 'DEPOSIT'
          ? PaymentRequirementType.DEPOSIT
          : service.requirePrepayment
            ? PaymentRequirementType.FULL
            : PaymentRequirementType.NONE

      const requirePrepayment = paymentRequirementType !== PaymentRequirementType.NONE
      const now = new Date()
      const slotHoldMinutes = 10
      const slotHeldUntil = requirePrepayment
        ? new Date(now.getTime() + slotHoldMinutes * 60 * 1000)
        : null
      const lifecycle = resolveAppointmentLifecycle({
        requiresProviderApproval: service.requireProviderApproval,
        paymentRequirementType,
      })

      const appointmentData = {
        clinicId,
        locationId: resolvedLocation.id,
        providerId,
        serviceId,
        disciplineId: service.disciplineId ?? null,
        patientId,
        timezone: resolvedLocation.timezone,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        status: lifecycle.status,
        priceAtBooking,
        paymentStatus: usingPackage ? PaymentStatus.PAID : lifecycle.paymentStatus,
        paymentRequirementType,
        approvalStatus: lifecycle.approvalStatus,
        bookingSource,
        depositAmount:
          paymentRequirementType === PaymentRequirementType.DEPOSIT
            ? service.depositAmount
              ? service.depositAmount.lte(priceAtBooking)
                ? service.depositAmount
                : priceAtBooking
              : null
            : paymentRequirementType === PaymentRequirementType.FULL
              ? priceAtBooking
              : null,
        paymentDueAt: requirePrepayment ? slotHeldUntil! : null,
        slotHeldUntil,
        bookingHoldExpiresAt: slotHeldUntil,
        meetLink: null, // Video calls are handled via Jitsi in the consultation room
        notes: context?.notes ?? null,
        createdById: performedById ?? null,
        updatedById: performedById ?? null,
        recurringSeriesId: context?.recurringSeriesId ?? null,
        aiScribeConsentGrantedAt: data.aiScribeConsent ? new Date() : null,
      }

      const appointment = await tx.appointment.create({
        data: appointmentData,
        include: {
          clinic: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          provider: {
            include: {
              disciplines: { include: { discipline: { select: { id: true, name: true } } } },
              user: { select: { id: true, name: true } },
            },
          },
          service: { select: { id: true, name: true, duration: true } },
          patient: { select: { id: true, name: true, email: true } },
        },
      })

      if (usingPackage && context?.patientPackageId && !context.skipPackageSessionConsumption) {
        const updatedPkg = await tx.patientPackage.update({
          where: { id: context.patientPackageId, clinicId },
          data: {
            usedSessions: { increment: 1 },
          },
        })

        if (updatedPkg.usedSessions >= updatedPkg.totalSessions) {
          await tx.patientPackage.update({
            where: { id: updatedPkg.id, clinicId },
            data: { status: 'EXHAUSTED' },
          })
        }

        await tx.packageSessionUsage.create({
          data: {
            patientPackageId: context.patientPackageId,
            appointmentId: appointment.id,
          },
        })

        await tx.auditLog.create({
          data: {
            clinicId,
            entityType: 'Appointment',
            entityId: appointment.id,
            action: 'PACKAGE_SESSION_CONSUMED',
            newValue: { patientPackageId: context.patientPackageId } as Prisma.InputJsonValue,
            performedById: performedById ?? patientId,
          },
        })
      }

      if (requirePrepayment && performedById) {
        await tx.auditLog.create({
          data: {
            clinicId,
            entityType: 'Appointment',
            entityId: appointment.id,
            action: 'PAYMENT_INITIATED',
            fieldChanged: null,
            oldValue: Prisma.JsonNull,
            newValue: {
              slotHeldUntil: slotHeldUntil?.toISOString(),
              amount: Number(priceAtBooking),
              standardAmount: Number(standardPriceAtBooking),
              membershipDiscountPercent: Number(membershipDiscountPercent),
            } as Prisma.InputJsonValue,
            performedById,
          },
        })
      }

      if (slotHoldId) {
        await tx.slotHold.update({
          where: { id: slotHoldId, clinicId },
          data: {
            convertedToAppointmentId: appointment.id,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          clinicId,
          entityType: 'Appointment',
          entityId: appointment.id,
          action: 'APPOINTMENT_CREATED',
          newValue: {
            providerId,
            patientId,
            locationId: resolvedLocation.id,
            status: appointment.status,
            bookingSource,
            timezone: resolvedLocation.timezone,
            priceAtBooking: Number(priceAtBooking),
            packageApplied: usingPackage,
            membershipDiscountPercent: Number(membershipDiscountPercent),
          } as Prisma.InputJsonValue,
          oldValue: Prisma.JsonNull,
          performedById: performedById ?? patientId,
        },
      })

      let clientSecret: string | undefined = undefined

      if (requirePrepayment) {
        const amountToCharge =
          paymentRequirementType === PaymentRequirementType.DEPOSIT
            ? Number(service.depositAmount)
            : Number(priceAtBooking)

        const amountInCents = Math.round(amountToCharge * 100)

        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'usd',
            metadata: {
              appointmentId: appointment.id,
              clinicId,
              patientId,
              type: 'APPOINTMENT',
            },
          })
          clientSecret = paymentIntent.client_secret ?? undefined

          await tx.payment.create({
            data: {
              clinicId,
              providerId,
              appointmentId: appointment.id,
              patientId,
              amount: amountToCharge,
              status: PaymentStatus.PENDING,
              stripePaymentIntentId: paymentIntent.id,
              stripeClientSecret: paymentIntent.client_secret ?? null,
              paymentChannel: 'STRIPE',
              paymentMethod: 'CARD',
            },
          })
        } catch (err) {
          console.error('Stripe PaymentIntent Error:', err)
          // We still created the appointment in PENDING_PAYMENT state
        }
      }

      return { appointment, clientSecret }
    })
  )
}

export interface CreateRecurringSeriesInput {
  clinicId: string
  locationId?: string | null
  providerId: string
  serviceId: string
  patientId: string
  firstStartTime: Date | string
  firstEndTime: Date | string
  frequency: 'WEEKLY'
  numberOfSessions?: number
  endDate?: Date | string | null
}

export interface RecurringConflict {
  date: string
  reason: string
}

export const createRecurringSeries = async (
  input: CreateRecurringSeriesInput,
  performedById: string
) =>
  withPatientSelfEnrollScope(input.clinicId, input.patientId, () =>
    createRecurringSeriesInScope(input, performedById)
  )

const createRecurringSeriesInScope = async (
  input: CreateRecurringSeriesInput,
  performedById: string
): Promise<{
  appointments: Awaited<ReturnType<typeof createAppointment>>['appointment'][]
  conflicts: RecurringConflict[]
}> => {
  const firstStart = new Date(input.firstStartTime)
  const firstEnd = new Date(input.firstEndTime)
  const durationMs = firstEnd.getTime() - firstStart.getTime()

  const occurrences: { start: Date; end: Date }[] = []
  const endDate = input.endDate ? new Date(input.endDate) : null
  const maxSessions = input.numberOfSessions ?? 52

  const location =
    (input.locationId
      ? await prisma.location.findFirst({
          where: { id: input.locationId, clinicId: input.clinicId, isActive: true },
          select: { id: true, timezone: true },
        })
      : await prisma.location.findFirst({
          where: { clinicId: input.clinicId, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, timezone: true },
        })) ?? null

  if (!location) {
    throw createApiError('Location not found', 404, 'validation_error')
  }

  const recurringSeries = await prisma.appointmentSeries.create({
    data: {
      clinicId: input.clinicId,
      patientId: input.patientId,
      providerId: input.providerId,
      serviceId: input.serviceId,
      locationId: location.id,
      timezone: location.timezone,
      frequency: input.frequency,
      numberOfSessions: input.numberOfSessions ?? null,
      endDate,
    },
  })

  for (let i = 0; i < maxSessions; i++) {
    const start = new Date(firstStart)
    start.setDate(start.getDate() + i * 7)
    const end = new Date(start.getTime() + durationMs)
    if (endDate && start > endDate) break
    occurrences.push({ start, end })
  }

  const appointments: Awaited<ReturnType<typeof createAppointment>>['appointment'][] = []
  const conflicts: RecurringConflict[] = []

  for (const { start, end } of occurrences) {
    try {
      const { appointment } = await createAppointment(
        {
          locationId: location.id,
          providerId: input.providerId,
          serviceId: input.serviceId,
          patientId: input.patientId,
          startTime: start,
          endTime: end,
        },
        input.clinicId,
        {
          performedById,
          bookingSource: BookingSource.PATIENT_PORTAL,
          recurringSeriesId: recurringSeries.id,
        }
      )
      appointments.push(appointment)
    } catch (err) {
      conflicts.push({
        date: start.toISOString().split('T')[0]!,
        reason: err instanceof Error ? err.message : 'Slot unavailable',
      })
    }
  }

  await auditService.logAudit({
    clinicId: input.clinicId,
    entityType: 'AppointmentSeries',
    entityId: recurringSeries.id,
    action: 'RECURRING_SERIES_CREATED',
    newValue: {
      appointmentCount: appointments.length,
      conflictCount: conflicts.length,
      frequency: input.frequency,
    },
    performedById,
  })

  return { appointments, conflicts }
}

export interface CancelAppointmentResult {
  appointment: Awaited<ReturnType<typeof prisma.appointment.update>>
  lateCancellation: boolean
  cancellationFee?: { type: string; value: string; amount?: string }
}

export const cancelAppointment = async (
  appointmentId: string,
  reason: string,
  performedById: string,
  where: { clinicId?: string; patientId?: string; providerId?: string } = {}
): Promise<CancelAppointmentResult> => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, ...clinicScope(), ...where },
    include: { service: true },
  })
  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (appointment.status === 'CANCELLED') {
    const err = new Error('Appointment is already cancelled') as ApiError
    err.statusCode = 400
    throw err
  }
  const windowHours = appointment.service.cancellationWindowHours ?? 0
  const now = new Date()
  const hoursBeforeStart = (appointment.startTime.getTime() - now.getTime()) / (1000 * 60 * 60)
  const withinWindow = hoursBeforeStart <= windowHours
  let cancellationFee: CancelAppointmentResult['cancellationFee'] | undefined
  const feeType = appointment.service.cancellationFeeType ?? 'NONE'
  if (withinWindow && feeType !== 'NONE' && appointment.service.cancellationFeeValue != null) {
    const val = Number(appointment.service.cancellationFeeValue)
    if (feeType === 'FIXED') {
      cancellationFee = { type: 'FIXED', value: val.toString(), amount: val.toString() }
    } else if (feeType === 'PERCENTAGE') {
      const amount = (Number(appointment.priceAtBooking) * val) / 100
      cancellationFee = { type: 'PERCENTAGE', value: val.toString(), amount: amount.toFixed(2) }
    }
  }
  const updated = await prisma.appointment.update({
    where: { id: appointmentId, clinicId: appointment.clinicId },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancellationReason: reason,
    },
    include: {
      clinic: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true, duration: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })
  await auditService.logAudit({
    clinicId: appointment.clinicId,
    entityType: 'Appointment',
    entityId: appointmentId,
    action: 'APPOINTMENT_CANCELLED',
    fieldChanged: 'status',
    oldValue: { status: appointment.status },
    newValue: {
      status: 'CANCELLED',
      reason,
      withinCancellationWindow: withinWindow,
    },
    performedById,
  })

  if (appointment.status !== 'COMPLETED' && appointment.status !== 'NO_SHOW') {
    const releasedPackage = await packageUsageService.releasePackageSession(appointmentId)
    if (releasedPackage) {
      await auditService.logAudit({
        clinicId: appointment.clinicId,
        entityType: 'Appointment',
        entityId: appointmentId,
        action: 'PACKAGE_SESSION_RELEASED',
        newValue: {
          patientPackageId: releasedPackage.id,
        },
        performedById,
      })
    }
  }

  // Send cancellation email
  await emailService.sendAppointmentCancellation({
    to: updated.patient.email,
    patientName: updated.patient.name,
    appointmentDate: updated.startTime.toLocaleString(),
    serviceName: updated.service.name,
    reason,
  })

  try {
    await waitlistService.offerSlotToWaitlist({
      clinicId: appointment.clinicId,
      providerId: appointment.providerId,
      serviceId: appointment.serviceId,
      slotStartTime: appointment.startTime,
      slotEndTime: appointment.endTime,
      locationId: appointment.locationId,
    })
  } catch {
    // Best-effort: do not fail cancellation if waitlist offer fails
  }

  return {
    appointment: updated,
    lateCancellation: withinWindow,
    cancellationFee,
  }
}

export interface RescheduleAppointmentData {
  locationId?: string | null
  newStartTime: string | Date
  newEndTime: string | Date
  slotHoldId?: string
}

export const rescheduleAppointment = async (
  oldAppointmentId: string,
  data: RescheduleAppointmentData,
  performedById: string,
  where: { clinicId?: string; patientId?: string; providerId?: string } = {}
) => {
  const oldAppointment = await prisma.appointment.findFirst({
    where: { id: oldAppointmentId, ...clinicScope(), ...where },
    include: { service: true },
  })
  if (!oldAppointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (oldAppointment.status === 'CANCELLED') {
    const err = new Error('Cannot reschedule a cancelled appointment') as ApiError
    err.statusCode = 400
    throw err
  }
  if (oldAppointment.status === 'RESCHEDULED') {
    const err = new Error('Appointment has already been rescheduled') as ApiError
    err.statusCode = 400
    throw err
  }
  const { newStartTime, newEndTime } = data
  const existingPackageUsage = await prisma.packageSessionUsage.findUnique({
    where: { appointmentId: oldAppointmentId },
  })
  const createData: CreateAppointmentData = {
    locationId: data.locationId ?? oldAppointment.locationId,
    providerId: oldAppointment.providerId,
    serviceId: oldAppointment.serviceId,
    patientId: oldAppointment.patientId,
    startTime: newStartTime,
    endTime: newEndTime,
  }
  const { appointment: newAppointment } = await createAppointment(
    createData,
    oldAppointment.clinicId,
    {
      performedById,
      excludeAppointmentId: oldAppointmentId,
      slotHoldId: data.slotHoldId,
      bookingSource: BookingSource.PATIENT_PORTAL,
      patientPackageId: existingPackageUsage?.patientPackageId,
      skipPackageSessionConsumption: Boolean(existingPackageUsage),
    }
  )
  await prisma.$transaction([
    prisma.appointment.update({
      where: { id: oldAppointmentId, clinicId: oldAppointment.clinicId },
      data: {
        status: 'RESCHEDULED',
        rescheduledToId: newAppointment.id,
        updatedById: performedById,
      },
    }),
    prisma.appointment.update({
      where: { id: newAppointment.id, clinicId: oldAppointment.clinicId },
      data: { rescheduledFromId: oldAppointmentId, updatedById: performedById },
    }),
  ])
  const updatedOld = await prisma.appointment.findUnique({
    where: { id: oldAppointmentId, clinicId: oldAppointment.clinicId },
    include: {
      clinic: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true, duration: true } },
      patient: { select: { id: true, name: true, email: true } },
      rescheduledTo: {
        include: {
          clinic: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          provider: {
            include: {
              disciplines: { include: { discipline: { select: { id: true, name: true } } } },
              user: { select: { id: true, name: true } },
            },
          },
          service: { select: { id: true, name: true, duration: true } },
          patient: { select: { id: true, name: true, email: true } },
        },
      },
    },
  })
  await auditService.logAudit({
    clinicId: oldAppointment.clinicId,
    entityType: 'Appointment',
    entityId: oldAppointmentId,
    action: 'APPOINTMENT_RESCHEDULED',
    fieldChanged: 'status',
    oldValue: { status: oldAppointment.status, appointmentId: oldAppointmentId },
    newValue: { status: 'RESCHEDULED', newAppointmentId: newAppointment.id },
    performedById,
  })

  const transferredUsage = await packageUsageService.transferPackageSessionReservation(
    oldAppointmentId,
    newAppointment.id
  )
  if (transferredUsage) {
    await auditService.logAudit({
      clinicId: oldAppointment.clinicId,
      entityType: 'Appointment',
      entityId: newAppointment.id,
      action: 'PACKAGE_SESSION_TRANSFERRED',
      newValue: {
        fromAppointmentId: oldAppointmentId,
      },
      performedById,
    })
  }
  return {
    oldAppointment: updatedOld,
    newAppointment,
  }
}

export const getAppointmentsByPatient = async (
  patientId: string,
  clinicId?: string | null,
  options?: { startDate?: Date; endDate?: Date }
) => {
  const where: Record<string, unknown> = { patientId, ...clinicScope() }
  if (clinicId) where.clinicId = clinicId
  if (options?.startDate || options?.endDate) {
    where.startTime = {}
    if (options.startDate) (where.startTime as { gte?: Date }).gte = options.startDate
    if (options.endDate) (where.startTime as { lte?: Date }).lte = options.endDate
  }
  return prisma.appointment.findMany({
    where,
    orderBy: { startTime: 'desc' },
    include: {
      location: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true } },
    },
  })
}

export const getAppointmentsByProvider = async (
  providerId: string,
  clinicId?: string | null,
  options?: { startDate?: Date; endDate?: Date }
) => {
  const where: Record<string, unknown> = { providerId, ...clinicScope() }
  if (clinicId) where.clinicId = clinicId
  if (options?.startDate || options?.endDate) {
    where.startTime = {}
    if (options.startDate) (where.startTime as { gte?: Date }).gte = options.startDate
    if (options.endDate) (where.startTime as { lte?: Date }).lte = options.endDate
  }
  return prisma.appointment.findMany({
    where,
    orderBy: { startTime: 'asc' },
    include: {
      location: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })
}

export const getAppointmentsByClinic = async (
  clinicId: string,
  options?: { startDate?: Date; endDate?: Date }
) => {
  const where: Record<string, unknown> = { clinicId }
  if (options?.startDate || options?.endDate) {
    where.startTime = {}
    if (options.startDate) (where.startTime as { gte?: Date }).gte = options.startDate
    if (options.endDate) (where.startTime as { lte?: Date }).lte = options.endDate
  }
  return prisma.appointment.findMany({
    where,
    orderBy: { startTime: 'desc' },
    include: {
      location: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })
}

export const getAppointmentById = async (
  id: string,
  where: { clinicId?: string; patientId?: string; providerId?: string } = {}
) => {
  return prisma.appointment.findFirst({
    where: { id, ...clinicScope(), ...where } as {
      id: string
      clinicId?: string
      patientId?: string
      providerId?: string
    },
    include: {
      clinic: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true, duration: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })
}

export interface AppointmentTimelineEvent {
  timestamp: Date
  action: string
  performedById: string | null
  details: { oldValue?: unknown; newValue?: unknown }
}

export const getAppointmentTimeline = async (
  appointmentId: string,
  where: { clinicId?: string; patientId?: string; providerId?: string } = {}
): Promise<{ appointmentId: string; events: AppointmentTimelineEvent[] }> => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, ...clinicScope(), ...where },
    select: { id: true, clinicId: true },
  })
  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      clinicId: appointment.clinicId,
      entityType: 'Appointment',
      entityId: appointmentId,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      createdAt: true,
      action: true,
      performedById: true,
      oldValue: true,
      newValue: true,
    },
  })

  const events: AppointmentTimelineEvent[] = logs.map((log) => ({
    timestamp: log.createdAt,
    action: log.action,
    performedById: log.performedById,
    details: {
      ...(log.oldValue != null &&
        log.oldValue !== undefined && { oldValue: log.oldValue as unknown }),
      ...(log.newValue != null &&
        log.newValue !== undefined && { newValue: log.newValue as unknown }),
    },
  }))

  return {
    appointmentId,
    events,
  }
}

export const getProviderByUserId = async (userId: string) => {
  return prisma.provider.findFirst({
    where: { userId, ...clinicScope() },
  })
}

export const updateAppointmentStatus = async (
  id: string,
  status: AppointmentStatus,
  req: Request
) => {
  const appointment = await prisma.appointment.findUnique({ where: { id, ...clinicScope() } })
  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (req.user?.role === 'PROVIDER') {
    const provider = await getProviderByUserId(req.user.id)
    if (!provider || provider.id !== appointment.providerId) {
      const err = new Error('Access denied') as ApiError
      err.statusCode = 403
      throw err
    }
    const allowedStatuses = ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']
    if (!allowedStatuses.includes(status)) {
      const err = new Error(
        'Provider can only update status to CONFIRMED, COMPLETED, NO_SHOW, or CANCELLED'
      ) as ApiError
      err.statusCode = 403
      throw err
    }
  }

  if (req.user?.role === 'PATIENT') {
    if (appointment.patientId !== req.user.id) {
      const err = new Error('Access denied') as ApiError
      err.statusCode = 403
      throw err
    }
    const allowedStatuses = ['CANCELLED']
    if (!allowedStatuses.includes(status)) {
      const err = new Error('Patient can only cancel appointments') as ApiError
      err.statusCode = 403
      throw err
    }
  }

  if (req.user?.role === 'FRONT_DESK' && req.clinicId !== appointment.clinicId) {
    const err = new Error('Access denied') as ApiError
    err.statusCode = 403
    throw err
  }

  const performedById = req.user?.id
  if (performedById && appointment.status !== status) {
    await auditService.logAudit({
      clinicId: appointment.clinicId,
      entityType: 'Appointment',
      entityId: id,
      action: 'UPDATE',
      fieldChanged: 'status',
      oldValue: appointment.status,
      newValue: status,
      performedById,
    })
  }

  const updated = await prisma.appointment.update({
    where: { id, clinicId: appointment.clinicId },
    data: {
      status,
      ...(status === AppointmentStatus.CONFIRMED &&
      appointment.status === AppointmentStatus.PENDING_PROVIDER_APPROVAL
        ? { approvalStatus: ApprovalStatus.APPROVED }
        : {}),
      updatedById: req.user?.id ?? null,
    },
    include: {
      location: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })

  if (
    status === AppointmentStatus.CANCELLED &&
    appointment.status !== AppointmentStatus.CANCELLED
  ) {
    await packageUsageService.releasePackageSession(id)
  }

  return updated
}
