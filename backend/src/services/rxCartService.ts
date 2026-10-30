/**
 * Prescription → Cart engine (B5.1–B5.3, B5.5).
 *
 *  scribe orders ──map──▶ RxOrderProposal (PENDING)
 *       provider reviews chips, removes / re-maps / adds
 *  "Approve & send" ──▶ confirmProposal (explicit, audited)
 *                   ──▶ buildCartFromProposal
 *                         CART lines       → patient's cart, with provenance
 *                         EPRESCRIBE lines → Prescription(PENDING_EPRESCRIBE)
 *
 * A cart is never built from a proposal that a provider has not confirmed:
 * buildCartFromProposal refuses anything but a CONFIRMED proposal.
 */
import type { Prisma, RxOrderProposal } from '@prisma/client'
import prisma, { type TxClient } from '../config/prisma'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'
import { mapOrdersToCatalog, routeFor, type ScribeOrder } from './rxMappingService'

type Tx = TxClient
/** Either the client or a transaction: only the delegates these helpers read. */
type Db = Pick<TxClient, 'rxOrderProposal' | 'product'>

const apiError = (status: number, code: string, message: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = status
  err.code = code
  return err
}

const lineInclude = {
  matchedProduct: {
    select: { id: true, name: true, sku: true, price: true, fulfillmentClass: true },
  },
} satisfies Prisma.RxOrderLineInclude

const proposalInclude = {
  lines: { include: lineInclude, orderBy: { position: 'asc' } },
} satisfies Prisma.RxOrderProposalInclude

export type ProposalWithLines = Prisma.RxOrderProposalGetPayload<{
  include: typeof proposalInclude
}>

/**
 * Creates (or, while still PENDING, replaces) the proposal for a scribe
 * session from the orders the scribe extracted. A proposal the provider has
 * already confirmed is never touched. Runs in the scribe worker's scope, so
 * every query names its clinic explicitly.
 */
export async function upsertProposalForSession(
  sessionId: string,
  clinicId: string,
  orders: ScribeOrder[]
): Promise<ProposalWithLines | null> {
  const session = await prisma.aIScribeSession.findFirst({
    where: { id: sessionId, clinicId },
    select: {
      id: true,
      clinicId: true,
      providerId: true,
      visitRecord: { select: { id: true, appointmentId: true, patientId: true } },
    },
  })
  if (!session) return null

  const existing = await prisma.rxOrderProposal.findFirst({
    where: { aiScribeSessionId: sessionId, clinicId },
  })
  if (existing && existing.status !== 'PENDING') return null

  const mapped = await mapOrdersToCatalog(clinicId, orders)

  const proposalId = await prisma.$transaction(async (tx) => {
    let id = existing?.id
    if (id) {
      await tx.rxOrderLine.deleteMany({ where: { proposalId: id, clinicId } })
    } else {
      const created = await tx.rxOrderProposal.create({
        data: {
          clinicId,
          aiScribeSessionId: session.id,
          visitRecordId: session.visitRecord.id,
          appointmentId: session.visitRecord.appointmentId,
          patientId: session.visitRecord.patientId,
          providerId: session.providerId,
        },
      })
      id = created.id
    }
    for (const [position, line] of mapped.entries()) {
      await tx.rxOrderLine.create({
        data: {
          clinicId,
          proposalId: id,
          rawText: line.rawText,
          dose: line.dose,
          quantity: line.quantity,
          matchedProductId: line.matchedProductId,
          matchStatus: line.matchStatus,
          route: line.route,
          position,
        },
      })
    }
    return id
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'RxOrderProposal',
    entityId: proposalId,
    action: existing ? 'RX_PROPOSAL_REBUILT' : 'RX_PROPOSAL_CREATED',
    newValue: {
      lines: mapped.length,
      unmapped: mapped.filter((l) => l.route === 'MANUAL').length,
    },
    performedById: null,
  })

  return prisma.rxOrderProposal.findFirst({
    where: { id: proposalId, clinicId },
    include: proposalInclude,
  })
}

/** The proposal for one of this provider's scribe sessions, or null. */
export const getProposalForSession = (sessionId: string, providerId: string, clinicId: string) =>
  prisma.rxOrderProposal.findFirst({
    where: { aiScribeSessionId: sessionId, providerId, clinicId },
    include: proposalInclude,
  })

const loadOwnProposal = async (
  db: Db,
  proposalId: string,
  providerId: string,
  clinicId: string
): Promise<ProposalWithLines> => {
  const proposal = await db.rxOrderProposal.findFirst({
    where: { id: proposalId, providerId, clinicId },
    include: proposalInclude,
  })
  // Another provider's or another clinic's proposal is reported as missing.
  if (!proposal) throw apiError(404, 'not_found', 'Proposal not found')
  return proposal
}

const findCatalogProduct = async (db: Db, productId: string, clinicId: string) => {
  const product = await db.product.findFirst({
    where: { id: productId, clinicId, isActive: true },
    select: { id: true, name: true, fulfillmentClass: true },
  })
  if (!product) throw apiError(404, 'product_not_found', 'Product not found in this clinic')
  return product
}

export interface LineChanges {
  lines?: { id: string; quantity?: number; productId?: string; removed?: boolean }[]
  add?: { productId: string; quantity?: number }[]
}

/** Provider edits before confirming: quantities, removals, re-mapping, additions. */
export async function updateProposalLines(
  proposalId: string,
  providerId: string,
  clinicId: string,
  performedById: string,
  changes: LineChanges
): Promise<ProposalWithLines> {
  const proposal = await loadOwnProposal(prisma, proposalId, providerId, clinicId)
  if (proposal.status !== 'PENDING') {
    throw apiError(409, 'proposal_closed', 'These products were already sent')
  }
  const lineIds = new Set(proposal.lines.map((l) => l.id))

  await prisma.$transaction(async (tx) => {
    for (const change of changes.lines ?? []) {
      if (!lineIds.has(change.id)) throw apiError(404, 'not_found', 'Line not found')
      const data: Prisma.RxOrderLineUpdateInput = {}
      if (change.quantity !== undefined) data.quantity = change.quantity
      if (change.removed !== undefined) data.decision = change.removed ? 'REMOVED' : 'PENDING'
      if (change.productId) {
        const product = await findCatalogProduct(tx, change.productId, clinicId)
        data.matchedProduct = { connect: { id: product.id } }
        data.matchStatus = 'MATCHED'
        data.route = routeFor(product.fulfillmentClass)
      }
      await tx.rxOrderLine.update({ where: { id: change.id, clinicId }, data })
    }
    let position = proposal.lines.length
    for (const add of changes.add ?? []) {
      const product = await findCatalogProduct(tx, add.productId, clinicId)
      await tx.rxOrderLine.create({
        data: {
          clinicId,
          proposalId,
          rawText: product.name,
          quantity: add.quantity ?? 1,
          matchedProductId: product.id,
          matchStatus: 'MATCHED',
          route: routeFor(product.fulfillmentClass),
          position: position++,
        },
      })
    }
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'RxOrderProposal',
    entityId: proposalId,
    action: 'RX_PROPOSAL_EDITED',
    newValue: { linesChanged: changes.lines?.length ?? 0, linesAdded: changes.add?.length ?? 0 },
    performedById,
  })

  return loadOwnProposal(prisma, proposalId, providerId, clinicId)
}

export interface RxConfirmation {
  confirmedLineIds: string[]
  acknowledged: true
}

/**
 * Records the provider's explicit confirmation (B5.2). Lines named in
 * `confirmedLineIds` are CONFIRMED; every other line is REMOVED. A line that
 * is not mapped to a product cannot be confirmed.
 */
export async function confirmProposal(
  tx: Tx,
  proposalId: string,
  providerId: string,
  clinicId: string,
  performedById: string,
  confirmation: RxConfirmation
): Promise<{ confirmed: number; removed: number }> {
  if (confirmation.acknowledged !== true) {
    throw apiError(400, 'confirmation_required', 'Provider confirmation is required')
  }
  const proposal = await loadOwnProposal(tx, proposalId, providerId, clinicId)
  if (proposal.status !== 'PENDING') {
    throw apiError(409, 'proposal_closed', 'These products were already sent')
  }
  const wanted = new Set(confirmation.confirmedLineIds)
  const known = new Set(proposal.lines.map((l) => l.id))
  for (const id of wanted) {
    if (!known.has(id)) throw apiError(404, 'not_found', 'Line not found')
  }
  for (const line of proposal.lines) {
    if (wanted.has(line.id) && (line.route === 'MANUAL' || !line.matchedProductId)) {
      throw apiError(
        422,
        'line_unmapped',
        'Map every confirmed item to a catalog product before sending'
      )
    }
  }

  let confirmed = 0
  let removed = 0
  for (const line of proposal.lines) {
    const decision = wanted.has(line.id) ? 'CONFIRMED' : 'REMOVED'
    if (decision === 'CONFIRMED') confirmed += 1
    else removed += 1
    await tx.rxOrderLine.update({ where: { id: line.id, clinicId }, data: { decision } })
  }
  await tx.rxOrderProposal.update({
    where: { id: proposalId, clinicId },
    data: { status: 'CONFIRMED', confirmedById: performedById, confirmedAt: new Date() },
  })
  return { confirmed, removed }
}

export interface BuiltCart {
  cartId: string | null
  cartItemIds: string[]
  prescriptionIds: string[]
}

/**
 * Builds the patient's cart from a CONFIRMED proposal (B5.3). Idempotent:
 * each line maps to at most one cart item / prescription (unique keys).
 */
export async function buildCartFromProposal(
  tx: Tx,
  proposalId: string,
  clinicId: string
): Promise<BuiltCart> {
  const proposal = await tx.rxOrderProposal.findFirst({
    where: { id: proposalId, clinicId },
    include: {
      lines: {
        where: { decision: 'CONFIRMED' },
        include: {
          matchedProduct: { select: { id: true, price: true, isActive: true, name: true } },
          cartItem: { select: { id: true } },
          prescription: { select: { id: true } },
        },
        orderBy: { position: 'asc' },
      },
    },
  })
  if (!proposal) throw apiError(404, 'not_found', 'Proposal not found')
  if (proposal.status !== 'CONFIRMED' || !proposal.confirmedById || !proposal.confirmedAt) {
    throw apiError(409, 'RX_NOT_CONFIRMED', 'A provider must confirm the products first')
  }

  const cartLines = proposal.lines.filter((l) => l.route === 'CART' && l.matchedProduct)
  const rxLines = proposal.lines.filter((l) => l.route === 'EPRESCRIBE' && l.matchedProduct)
  const built: BuiltCart = { cartId: proposal.cartId, cartItemIds: [], prescriptionIds: [] }

  if (cartLines.length > 0) {
    let cart = await tx.cart.findFirst({
      where: { clinicId, patientId: proposal.patientId, status: 'ACTIVE' },
      select: { id: true },
    })
    cart ??= await tx.cart.create({
      data: { clinicId, patientId: proposal.patientId, status: 'ACTIVE' },
      select: { id: true },
    })
    built.cartId = cart.id
    for (const line of cartLines) {
      if (line.cartItem) {
        built.cartItemIds.push(line.cartItem.id)
        continue
      }
      const item = await tx.cartItem.create({
        data: {
          cartId: cart.id,
          itemType: 'PRODUCT',
          productId: line.matchedProduct!.id,
          quantity: line.quantity,
          unitPrice: line.matchedProduct!.price,
          rxOrderLineId: line.id,
          prescribedByProviderId: proposal.providerId,
          patientDecision: 'PENDING',
        },
        select: { id: true },
      })
      built.cartItemIds.push(item.id)
    }
  }

  for (const line of rxLines) {
    if (line.prescription) {
      built.prescriptionIds.push(line.prescription.id)
      continue
    }
    const rx = await tx.prescription.create({
      data: {
        clinicId,
        appointmentId: proposal.appointmentId,
        providerId: proposal.providerId,
        patientId: proposal.patientId,
        notes: `${line.matchedProduct!.name} × ${line.quantity} — routed to e-prescribe (Rx→Cart scope guard)`,
        status: 'PENDING_EPRESCRIBE',
        rxOrderLineId: line.id,
      },
      select: { id: true },
    })
    built.prescriptionIds.push(rx.id)
  }

  if (built.cartId && built.cartId !== proposal.cartId) {
    await tx.rxOrderProposal.update({
      where: { id: proposalId, clinicId },
      data: { cartId: built.cartId },
    })
  }
  return built
}

/** Audit rows for a confirmed + built proposal. Ids and counts only — no product text. */
export async function auditConfirmAndBuild(
  proposal: Pick<RxOrderProposal, 'id' | 'clinicId'>,
  performedById: string,
  counts: { confirmed: number; removed: number },
  built: BuiltCart,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<void> {
  await auditService.logAudit({
    clinicId: proposal.clinicId,
    entityType: 'RxOrderProposal',
    entityId: proposal.id,
    action: 'RX_CART_CONFIRMED',
    newValue: counts,
    performedById,
    ...meta,
  })
  await auditService.logAudit({
    clinicId: proposal.clinicId,
    entityType: 'RxOrderProposal',
    entityId: proposal.id,
    action: 'RX_CART_BUILT',
    newValue: {
      cartId: built.cartId,
      cartItems: built.cartItemIds.length,
      eprescribe: built.prescriptionIds.length,
    },
    performedById,
    ...meta,
  })
}

/**
 * "Send" for a note that was approved without products: confirm and build in
 * one transaction. Only after the visit note is approved.
 */
export async function confirmAndSend(
  proposalId: string,
  providerId: string,
  clinicId: string,
  performedById: string,
  confirmation: RxConfirmation,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<BuiltCart> {
  const proposal = await loadOwnProposal(prisma, proposalId, providerId, clinicId)
  const session = await prisma.aIScribeSession.findFirst({
    where: { id: proposal.aiScribeSessionId, clinicId },
    select: { status: true },
  })
  if (session?.status !== 'APPROVED') {
    throw apiError(409, 'note_not_approved', 'Approve the visit note before sending products')
  }
  const { counts, built } = await prisma.$transaction(async (tx) => {
    const counts = await confirmProposal(
      tx,
      proposalId,
      providerId,
      clinicId,
      performedById,
      confirmation
    )
    const built = await buildCartFromProposal(tx, proposalId, clinicId)
    return { counts, built }
  })
  await auditConfirmAndBuild(proposal, performedById, counts, built, meta)
  return built
}
