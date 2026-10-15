import type { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'
import * as slotHoldService from '../services/slotHoldService'
import * as availabilityService from '../services/availabilityService'

const ONLINE_LOCATION_NAMES = ['online', 'virtual']

// Public clinic routes accept either the cuid (e.g. `clinic_0dzeprrd`) or
// the human slug (e.g. `everwell`) in the `:id` path param. Every handler
// below normalises through this resolver so /clinic/everwell shows the same
// data as /clinic/<cuid>.
const resolveClinicId = async (idOrSlug: string): Promise<string | null> => {
  if (!idOrSlug) return null
  const clinic = await prisma.clinic.findFirst({
    where: { isActive: true, OR: [{ slug: idOrSlug }, { id: idOrSlug }] },
    select: { id: true },
  })
  return clinic?.id ?? null
}

export const listClinics = asyncHandler(
  async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinics = await prisma.clinic.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        logoUrl: true,
        themeColor: true,
        subscriptionPlan: true,
      },
      orderBy: { name: 'asc' },
    })
    successResponse(res, 200, 'Clinics retrieved', { clinics })
  }
)

// Resolve by slug first, then by id. Lets the same /clinics/:idOrSlug
// route work for both pretty URLs and legacy cuid links without forking
// the API surface.
export const getClinic = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const idOrSlug = req.params.id as string
    const clinic = await prisma.clinic.findFirst({
      where: { isActive: true, OR: [{ slug: idOrSlug }, { id: idOrSlug }] },
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        logoUrl: true,
        themeColor: true,
        subscriptionPlan: true,
      },
    })
    if (!clinic) {
      const err = new Error('Clinic not found') as ApiError
      err.statusCode = 404
      throw err
    }
    successResponse(res, 200, 'Clinic retrieved', { clinic })
  }
)

export const getClinicServices = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const clinicId = await resolveClinicId(id)
    if (!clinicId) {
      successResponse(res, 200, 'Services retrieved', { services: [] })
      return
    }
    const services = await prisma.service.findMany({
      where: {
        clinicId,
        isActive: true,
        isArchived: false,
        discipline: { isArchived: false },
      },
      orderBy: { name: 'asc' },
      include: {
        discipline: { select: { id: true, name: true } },
        recommendedProducts: {
          select: { id: true, name: true, price: true, description: true },
        },
      },
    })
    successResponse(res, 200, 'Services retrieved', { services })
  }
)

export const getClinicProviders = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const idOrSlug = (req.params.id as string) || (req.query.clinicId as string)
    const clinicId = await resolveClinicId(idOrSlug)
    if (!clinicId) {
      successResponse(res, 200, 'Providers retrieved', { providers: [] })
      return
    }
    const providers = await prisma.provider.findMany({
      where: { clinicId, isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        disciplines: { include: { discipline: { select: { id: true, name: true } } } },
        locationAssignments: {
          where: { location: { isActive: true } },
          include: {
            location: { select: { id: true, name: true, timezone: true } },
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        providerServices: {
          select: { serviceId: true },
        },
        providerAvailability: {
          select: { weekday: true, locationId: true },
        },
        providerUnavailability: {
          where: {
            date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
          select: { date: true, startTime: true, endTime: true },
        },
      },
    })
    successResponse(res, 200, 'Providers retrieved', { providers })
  }
)

export const getClinicLocations = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const idOrSlug = req.params.id as string
    const clinicId = await resolveClinicId(idOrSlug)
    if (!clinicId) {
      successResponse(res, 200, 'Locations retrieved', { locations: [] })
      return
    }
    const locations = await prisma.location.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, name: true, address: true, timezone: true },
    })
    locations.sort((left, right) => {
      const leftOnline = ONLINE_LOCATION_NAMES.includes(left.name.trim().toLowerCase()) ? 1 : 0
      const rightOnline = ONLINE_LOCATION_NAMES.includes(right.name.trim().toLowerCase()) ? 1 : 0
      return rightOnline - leftOnline || left.name.localeCompare(right.name)
    })
    successResponse(res, 200, 'Locations retrieved', { locations })
  }
)

export const getClinicProducts = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const idOrSlug = req.params.id as string
    const clinicId = await resolveClinicId(idOrSlug)
    if (!clinicId) {
      successResponse(res, 200, 'Products retrieved', { products: [] })
      return
    }
    const products = await prisma.product.findMany({
      where: {
        clinicId,
        isActive: true,
      },
      include: {
        inventoryItem: true,
      },
      orderBy: { name: 'asc' },
    })
    successResponse(res, 200, 'Products retrieved', { products })
  }
)

export const getClinicPackages = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const idOrSlug = req.params.id as string
    const clinicId = await resolveClinicId(idOrSlug)
    if (!clinicId) {
      successResponse(res, 200, 'Packages retrieved', { packages: [] })
      return
    }
    const packages = await prisma.package.findMany({
      where: {
        clinicId,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    })
    successResponse(res, 200, 'Packages retrieved', { packages })
  }
)

export const getClinicMemberships = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const idOrSlug = req.params.id as string
    const clinicId = await resolveClinicId(idOrSlug)
    if (!clinicId) {
      successResponse(res, 200, 'Memberships retrieved', { memberships: [] })
      return
    }
    const memberships = await prisma.membership.findMany({
      where: {
        clinicId,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    })
    successResponse(res, 200, 'Memberships retrieved', { memberships })
  }
)

export const getProduct = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const product = await prisma.product.findFirst({
      where: { id, isActive: true },
      include: {
        inventoryItem: true,
      },
    })
    if (!product) {
      const err = new Error('Product not found') as ApiError
      err.statusCode = 404
      throw err
    }
    successResponse(res, 200, 'Product retrieved', { product })
  }
)

export const checkPatientExists = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { email } = (req.body ?? {}) as { email?: unknown }
    if (!email || typeof email !== 'string') {
      const err = new Error('Email is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const user = await prisma.user.findUnique({
      where: { email, role: 'PATIENT' },
      select: { id: true },
    })
    successResponse(res, 200, 'Check complete', { exists: !!user })
  }
)

export const getAvailability = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { clinicId, serviceId, providerId, locationId, date } = req.query as {
      clinicId?: string
      serviceId?: string
      providerId?: string
      locationId?: string
      date?: string
    }

    if (!clinicId || !serviceId || !date) {
      const err = new Error('clinicId, serviceId, and date are required') as ApiError
      err.statusCode = 400
      err.code = 'validation_error'
      throw err
    }

    const service = await prisma.service.findFirst({
      where: {
        id: serviceId,
        clinicId,
        isActive: true,
        isArchived: false,
        discipline: { isArchived: false },
      },
    })
    if (!service) {
      const err = new Error('Service not found') as ApiError
      err.statusCode = 404
      err.code = 'validation_error'
      throw err
    }

    let resolvedLocation = locationId
      ? await prisma.location.findFirst({
          where: { id: locationId, clinicId, isActive: true },
          select: { id: true, timezone: true },
        })
      : await prisma.location.findFirst({
          where: {
            clinicId,
            isActive: true,
            OR: ONLINE_LOCATION_NAMES.map((name) => ({
              name: { equals: name, mode: 'insensitive' as const },
            })),
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, timezone: true },
        })

    // Fallback to the first available location if no online/requested location is found
    if (!resolvedLocation) {
      resolvedLocation = await prisma.location.findFirst({
        where: { clinicId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, timezone: true },
      })
    }

    // If still no location, we allow the request to proceed with a virtual 'None' location
    // to search for providers who might have general availability.
    const effectiveLocationId = resolvedLocation?.id

    // Removed strict 404 throw for missing location, as the scheduling service
    // can handle null locationId for general availability checks.

    let providerIds: string[] = []
    if (providerId) {
      const p = await prisma.provider.findFirst({
        where: {
          id: providerId,
          clinicId,
          isActive: true,
          providerServices: { some: { serviceId } },
          // Removed the strict locationAssignment check here to allow the scheduling service
          // to handle location-specific availability windows more flexibly.
        },
      })
      if (p) providerIds = [p.id]
    } else {
      const providers = await prisma.provider.findMany({
        where: {
          clinicId,
          isActive: true,
          providerServices: { some: { serviceId } },
          // Allow all providers who offer the service to be checked for availability.
          // They will only produce slots if they have a valid assignment/availability record.
        },
        select: { id: true },
      })
      providerIds = providers.map((p) => p.id)
    }

    const slots: Awaited<ReturnType<typeof availabilityService.getAvailableSlots>> = []
    for (const pid of providerIds) {
      const providerSlots = await availabilityService.getAvailableSlots({
        providerId: pid,
        serviceId,
        locationId: effectiveLocationId ?? null,
        serviceDurationMinutes: service.duration,
        date,
        clinicId,
      })
      slots.push(...providerSlots)
    }

    slots.sort((left, right) => left.start.localeCompare(right.start))

    successResponse(res, 200, 'Availability retrieved', { slots })
  }
)

export const createSlotHold = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { clinicId, providerId, serviceId, locationId, timezone, startTime, endTime, patientId } =
      req.body as {
        clinicId: string
        providerId: string
        serviceId: string
        locationId?: string | null
        timezone: string
        startTime: string
        endTime: string
        patientId?: string
      }
    if (!clinicId || !providerId || !serviceId || !startTime || !endTime || !timezone) {
      const err = new Error(
        'clinicId, providerId, serviceId, timezone, startTime, and endTime are required'
      ) as ApiError
      err.statusCode = 400
      err.code = 'validation_error'
      throw err
    }
    const hold = await slotHoldService.createSlotHold({
      clinicId,
      providerId,
      serviceId,
      locationId: locationId ?? null,
      timezone,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      patientId,
      performedById: patientId,
    })
    successResponse(res, 201, 'Slot hold created', { hold })
  }
)

export const releaseSlotHold = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const holdId = req.params.holdId as string
    const clinicId =
      (req.query.clinicId as string) ||
      ((req.body as { clinicId?: string } | undefined)?.clinicId as string)
    if (!clinicId) {
      const err = new Error('clinicId is required') as ApiError
      err.statusCode = 400
      err.code = 'validation_error'
      throw err
    }
    const released = await slotHoldService.releaseSlotHold(holdId, clinicId)
    successResponse(res, 200, released ? 'Slot hold released' : 'Slot hold not found', {
      released,
    })
  }
)

export const getAvailableDatesSummary = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = (req.params.clinicId as string) || (req.query.clinicId as string)
    const { serviceId, providerId, locationId, startDate, endDate } = req.query as Record<
      string,
      string | undefined
    >

    if (!serviceId || !startDate || !endDate || !clinicId) {
      const err = new Error(
        'Clinic ID, Service ID, start date, and end date are required'
      ) as ApiError
      err.statusCode = 400
      throw err
    }

    const availableDates = await availabilityService.getAvailableDatesInRange({
      clinicId,
      serviceId,
      providerId: providerId || undefined,
      locationId: locationId || undefined,
      startDate,
      endDate,
    })

    successResponse(res, 200, 'Available dates retrieved', { availableDates })
  }
)
