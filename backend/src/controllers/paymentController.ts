import type { Request, Response, NextFunction } from 'express'
import * as paymentService from '../services/paymentService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'

const getPaymentWhere = (req: Request): { clinicId?: string; patientId?: string } => {
  if (req.user!.role === 'PATIENT') return { patientId: req.user!.id }
  if (req.user!.role === 'FRONT_DESK' && req.clinicId) return { clinicId: req.clinicId }
  return {}
}

export const confirm = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const appointmentId = req.params.appointmentId as string
    const where = getPaymentWhere(req)
    const result = await paymentService.confirmPayment(appointmentId, req.user!.id, where)
    successResponse(res, 200, 'Payment confirmed', {
      payment: result.payment,
      appointment: result.appointment,
    })
  }
)

export const demoConfirm = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const appointmentId = req.params.appointmentId as string
    const where = getPaymentWhere(req)
    const result = await paymentService.demoConfirmPayment(appointmentId, req.user!.id, where)
    successResponse(res, 200, 'Demo Payment confirmed', {
      payment: result.payment,
      appointment: result.appointment,
    })
  }
)

export const intent = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const appointmentId = req.params.appointmentId as string
    const where = getPaymentWhere(req)
    const result = await paymentService.ensurePaymentIntent(appointmentId, req.user!.id, where)
    successResponse(res, 200, 'Payment intent ready', {
      payment: result.payment,
      clientSecret: result.clientSecret,
      reused: result.reused,
    })
  }
)

export const fail = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const appointmentId = req.params.appointmentId as string
    const where = getPaymentWhere(req)
    const result = await paymentService.failPayment(appointmentId, req.user!.id, where)
    successResponse(res, 200, 'Payment recorded as failed', {
      payment: result.payment,
      appointment: result.appointment,
    })
  }
)

export const refund = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const paymentId = req.params.paymentId as string
    const where = req.clinicId ? { clinicId: req.clinicId } : undefined
    const amount = (req.body as { amount?: number | string } | undefined)?.amount
    const result = await paymentService.refundPayment(paymentId, req.user!.id, amount, where)
    successResponse(res, 200, 'Payment refunded', {
      refund: result.refund,
      appointment: result.appointment,
    })
  }
)
