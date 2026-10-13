import type { Request, Response, NextFunction } from 'express'
import * as inventoryService from '../services/inventoryService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'

export const getAll = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const inventory = await inventoryService.getInventory(clinicId)
    successResponse(res, 200, 'Inventory retrieved successfully', { inventory })
  }
)

export const getByProductId = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const productId = req.params.productId as string
    const inventoryItem = await inventoryService.getInventoryByProductId(productId, clinicId)
    successResponse(res, 200, 'Inventory item retrieved successfully', { inventoryItem })
  }
)

export const adjust = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const productId = req.params.productId as string

    const inventoryItem = await inventoryService.adjustInventory(
      productId,
      clinicId,
      req.body as inventoryService.AdjustInventoryInput
    )
    successResponse(res, 200, 'Inventory adjusted successfully', { inventoryItem })
  }
)
