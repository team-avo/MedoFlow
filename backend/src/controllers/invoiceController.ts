import type { Request, Response, NextFunction } from 'express'
import * as invoiceService from '../services/invoiceService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { assertClinicAccess } from '../middleware/clinicScope'
import type { ApiError } from '../types/errors'
import type {
  AddInvoiceItemInput,
  CatalogInvoiceItemInput,
  UpdateInvoiceItemInput,
} from '../services/invoiceService'

const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const { appointmentId, providerId, patientId, locationId } = req.body as {
      appointmentId?: string
      providerId?: string
      patientId?: string
      locationId?: string
    }

    if (appointmentId && !providerId) {
      const err = new Error('providerId is required') as ApiError
      err.statusCode = 400
      throw err
    }

    if (!appointmentId && !patientId) {
      const err = new Error('Either appointmentId or patientId is required') as ApiError
      err.statusCode = 400
      throw err
    }

    const invoice = await invoiceService.createInvoice(
      appointmentId,
      clinicId,
      providerId,
      req.user!.id,
      patientId,
      locationId
    )
    successResponse(res, 201, 'Invoice created', { invoice })
  }
)

export const addItem = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const invoiceId = req.params.id as string
    const { serviceId, description, unitPrice, quantity, itemType, itemId } =
      req.body as AddInvoiceItemInput & CatalogInvoiceItemInput
    if (!serviceId && !(itemType && itemId)) {
      const err = new Error('Either serviceId or itemType + itemId are required') as ApiError
      err.statusCode = 400
      throw err
    }
    const invoice = await invoiceService.getInvoiceById(invoiceId)
    if (!invoice) {
      const err = new Error('Invoice not found') as ApiError
      err.statusCode = 404
      throw err
    }
    assertClinicAccess(req, invoice.clinicId)
    const item = serviceId
      ? await invoiceService.addInvoiceItem(
          invoiceId,
          { serviceId, description, unitPrice, quantity },
          req.user!.id
        )
      : await invoiceService.addCatalogInvoiceItem(
          invoiceId,
          { itemType, itemId, description, unitPrice, quantity },
          req.user!.id
        )
    successResponse(res, 201, 'Invoice item added', { item })
  }
)

export const updateItem = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const invoiceId = req.params.id as string
    const itemId = req.params.itemId as string
    const { unitPrice, quantity } = req.body as UpdateInvoiceItemInput
    const invoice = await invoiceService.getInvoiceById(invoiceId)
    if (!invoice) {
      const err = new Error('Invoice not found') as ApiError
      err.statusCode = 404
      throw err
    }
    assertClinicAccess(req, invoice.clinicId)
    const item = await invoiceService.updateInvoiceItem(
      invoiceId,
      itemId,
      { unitPrice, quantity },
      req.user!.id
    )
    successResponse(res, 200, 'Invoice item updated', { item })
  }
)

export const deleteItem = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const invoiceId = req.params.id as string
    const itemId = req.params.itemId as string
    const invoice = await invoiceService.getInvoiceById(invoiceId)
    if (!invoice) {
      const err = new Error('Invoice not found') as ApiError
      err.statusCode = 404
      throw err
    }
    assertClinicAccess(req, invoice.clinicId)
    await invoiceService.deleteInvoiceItem(invoiceId, itemId, req.user!.id)
    successResponse(res, 200, 'Invoice item deleted')
  }
)

export const finalize = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const invoiceId = req.params.id as string
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const invoice = await invoiceService.finalizeInvoice(invoiceId, clinicId, req.user!.id)
    successResponse(res, 200, 'Invoice finalized', { invoice })
  }
)

export const pay = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const invoiceId = req.params.id as string
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const invoice = await invoiceService.payInvoice(invoiceId, clinicId, req.user!.id)
    successResponse(res, 200, 'Invoice paid', { invoice })
  }
)

export const recordManualPayment = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const invoiceId = req.params.id as string
    const clinicId = req.user!.clinicId!
    const { amount, paymentMethod, notes } = req.body as {
      amount?: number | string
      paymentMethod?: string
      notes?: string
    }
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    if (amount === undefined || !paymentMethod) {
      const err = new Error('amount and paymentMethod are required') as ApiError
      err.statusCode = 400
      throw err
    }
    const result = await invoiceService.recordInvoiceManualPayment(
      invoiceId,
      clinicId,
      req.user!.id,
      { amount, paymentMethod, notes }
    )
    successResponse(res, 200, 'Manual payment recorded', result)
  }
)

export const getById = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const clinicId = req.clinicId!
    const invoice = await invoiceService.getInvoiceById(id, clinicId ?? undefined)
    if (!invoice) {
      const err = new Error('Invoice not found') as ApiError
      err.statusCode = 404
      throw err
    }
    assertClinicAccess(req, invoice.clinicId)
    successResponse(res, 200, 'Invoice retrieved', { invoice })
  }
)

export const listByClinic = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId!
    const status = req.query.status as string | undefined
    const financialStatus = req.query.financialStatus as string | undefined
    const providerId = req.query.providerId as string | undefined
    const dateFromStr = queryString(req.query.dateFrom)
    const dateFrom = dateFromStr ? new Date(dateFromStr) : undefined
    const dateToStr = queryString(req.query.dateTo)
    const dateTo = dateToStr ? new Date(dateToStr) : undefined
    const invoices = await invoiceService.getInvoicesByClinic(clinicId, status, financialStatus, {
      providerId,
      dateFrom,
      dateTo,
    })
    successResponse(res, 200, 'Invoices retrieved', { invoices })
  }
)

export const getMyInvoices = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.user!.id
    const clinicId = req.user!.clinicId!
    const invoices = await invoiceService.getInvoicesByPatient(patientId, clinicId)
    successResponse(res, 200, 'My invoices retrieved', { invoices })
  }
)

export const receivablesSummary = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId!
    const summary = await invoiceService.getClinicReceivablesSummary(clinicId)
    successResponse(res, 200, 'Receivables summary retrieved', { summary })
  }
)

export const financeSummary = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId!
    const providerId = req.query.providerId as string | undefined
    const dateFromStr = queryString(req.query.dateFrom)
    const dateFrom = dateFromStr ? new Date(dateFromStr) : undefined
    const dateToStr = queryString(req.query.dateTo)
    const dateTo = dateToStr ? new Date(dateToStr) : undefined
    const summary = await invoiceService.getClinicFinanceSummary(clinicId, {
      providerId,
      dateFrom,
      dateTo,
    })
    successResponse(res, 200, 'Finance summary retrieved', { summary })
  }
)

export const getByAppointment = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const appointmentId = req.params.appointmentId as string
    const clinicId = req.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const invoices = await invoiceService.getInvoicesByAppointment(appointmentId, clinicId)
    successResponse(res, 200, 'Invoices retrieved', { invoices })
  }
)
