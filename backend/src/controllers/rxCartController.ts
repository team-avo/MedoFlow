import type { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import * as rxCartService from '../services/rxCartService'
import * as visitService from '../services/visitService'
import { requestMeta } from '../services/auditService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'

const providerScope = async (req: Request): Promise<{ providerId: string; clinicId: string }> => {
  const provider = await visitService.getProviderByUserId(req.user!.id)
  const clinicId = req.user!.clinicId
  if (!provider || !clinicId) {
    const err = new Error('Provider profile not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return { providerId: provider.id, clinicId }
}

/** GET /rx-cart/sessions/:sessionId/proposal — the detected products for review. */
export const getProposal = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const proposal = await rxCartService.getProposalForSession(
      req.params.sessionId as string,
      providerId,
      clinicId
    )
    successResponse(res, 200, 'Proposal retrieved', { proposal })
  }
)

/** GET /rx-cart/catalog — active products the provider can map an item to. */
export const getCatalog = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { clinicId } = await providerScope(req)
    const products = await prisma.product.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, name: true, sku: true, price: true, fulfillmentClass: true },
      orderBy: { name: 'asc' },
    })
    successResponse(res, 200, 'Catalog retrieved', { products })
  }
)

/** PUT /rx-cart/proposals/:id/lines — edit lines before confirming. */
export const updateLines = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const proposal = await rxCartService.updateProposalLines(
      req.params.id as string,
      providerId,
      clinicId,
      req.user!.id,
      req.body as rxCartService.LineChanges
    )
    successResponse(res, 200, 'Proposal updated', { proposal })
  }
)

/** POST /rx-cart/proposals/:id/confirm — send products for an already-approved note. */
export const confirm = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const result = await rxCartService.confirmAndSend(
      req.params.id as string,
      providerId,
      clinicId,
      req.user!.id,
      req.body as rxCartService.RxConfirmation,
      requestMeta(req)
    )
    successResponse(res, 200, 'Products sent to the patient', { rxCart: result })
  }
)
