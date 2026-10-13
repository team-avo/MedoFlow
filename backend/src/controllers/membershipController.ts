import type { Request, Response, NextFunction } from 'express'
import * as membershipService from '../services/membershipService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'

export const getAll = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const memberships = await membershipService.getMemberships(clinicId)
    successResponse(res, 200, 'Memberships retrieved successfully', { memberships })
  }
)

export const getById = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const id = req.params.id as string
    const membership = await membershipService.getMembershipById(id, clinicId)
    successResponse(res, 200, 'Membership retrieved successfully', { membership })
  }
)

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const membership = await membershipService.createMembership(
      clinicId,
      req.body as membershipService.CreateMembershipInput
    )
    successResponse(res, 201, 'Membership created successfully', { membership })
  }
)

export const update = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const id = req.params.id as string
    const membership = await membershipService.updateMembership(
      id,
      clinicId,
      req.body as membershipService.UpdateMembershipInput
    )
    successResponse(res, 200, 'Membership updated successfully', { membership })
  }
)

export const remove = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const id = req.params.id as string
    await membershipService.deleteMembership(id, clinicId)
    successResponse(res, 200, 'Membership deleted successfully')
  }
)

export const getMySubscriptions = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const subscriptions = await membershipService.listPatientSubscriptions(clinicId, req.user!.id)
    successResponse(res, 200, 'Subscriptions retrieved successfully', { subscriptions })
  }
)

export const getOperationalSummary = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const summary = await membershipService.getMembershipOperationalSummary(clinicId)
    successResponse(res, 200, 'Membership operational summary retrieved', { summary })
  }
)

export const purchase = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const membershipId = req.params.id as string
    const result = await membershipService.startMembershipPurchase(
      clinicId,
      req.user!.id,
      membershipId
    )
    successResponse(res, 200, 'Membership checkout created', result)
  }
)

export const cancelAtPeriodEnd = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const subscriptionId = req.params.subscriptionId as string
    const subscription = await membershipService.cancelMembershipAtPeriodEnd(
      clinicId,
      req.user!.id,
      subscriptionId
    )
    successResponse(res, 200, 'Membership cancellation scheduled', { subscription })
  }
)
