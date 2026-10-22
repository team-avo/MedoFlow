import type { Request, Response, NextFunction } from 'express'
import * as productService from '../services/productService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'

export const getAll = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const products = await productService.getProducts(clinicId)
    successResponse(res, 200, 'Products retrieved successfully', { products })
  }
)

export const getById = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const id = req.params.id as string
    const product = await productService.getProductById(id, clinicId)
    successResponse(res, 200, 'Product retrieved successfully', { product })
  }
)

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const product = await productService.createProduct(
      clinicId,
      req.body as productService.CreateProductInput
    )
    successResponse(res, 201, 'Product created successfully', { product })
  }
)

export const update = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const id = req.params.id as string
    const product = await productService.updateProduct(
      id,
      clinicId,
      req.body as productService.UpdateProductInput
    )
    successResponse(res, 200, 'Product updated successfully', { product })
  }
)

export const remove = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const id = req.params.id as string
    await productService.deleteProduct(id, clinicId)
    successResponse(res, 200, 'Product deleted successfully')
  }
)
