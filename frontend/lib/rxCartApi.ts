/**
 * Prescription → Cart (Component 5).
 *
 * Provider: the products the scribe detected in a visit, mapped to the
 * clinic catalog, confirmed before "Approve & send".
 * Patient: accept / decline prescribed items, card + address on file from
 * booking, one-click "Pay with card on file".
 */
import api from './api'

export type FulfillmentClass =
  | 'SUPPLEMENT'
  | 'OTC'
  | 'AESTHETIC'
  | 'RX_NON_SCHEDULED'
  | 'RX_SCHEDULED'

export const FULFILLMENT_CLASS_LABELS: Record<FulfillmentClass, string> = {
  SUPPLEMENT: 'Supplement',
  OTC: 'Over the counter',
  AESTHETIC: 'Aesthetic',
  RX_NON_SCHEDULED: 'Prescription (non-scheduled)',
  RX_SCHEDULED: 'Prescription (scheduled)',
}

export type RxRoute = 'CART' | 'EPRESCRIBE' | 'MANUAL'

export interface RxLine {
  id: string
  rawText: string
  quantity: number
  matchedProductId: string | null
  matchStatus: 'MATCHED' | 'AMBIGUOUS' | 'UNMAPPED'
  route: RxRoute
  decision: 'PENDING' | 'CONFIRMED' | 'REMOVED'
  matchedProduct: {
    id: string
    name: string
    sku: string | null
    price: string | number
    fulfillmentClass: FulfillmentClass
  } | null
}

export interface RxProposal {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
  lines: RxLine[]
}

export interface CatalogProduct {
  id: string
  name: string
  sku: string | null
  price: string | number
  fulfillmentClass: FulfillmentClass
}

/** The provider's explicit confirmation sent with "Approve & send". */
export interface RxConfirmation {
  proposalId: string
  confirmedLineIds: string[]
  acknowledged: true
}

export interface RxCartResult {
  cartId: string | null
  cartItemIds: string[]
  prescriptionIds: string[]
}

export const getProposal = async (sessionId: string): Promise<RxProposal | null> => {
  const { data } = await api.get(`/rx-cart/sessions/${sessionId}/proposal`)
  return data.data.proposal as RxProposal | null
}

export const getCatalog = async (): Promise<CatalogProduct[]> => {
  const { data } = await api.get('/rx-cart/catalog')
  return data.data.products as CatalogProduct[]
}

export const updateProposalLines = async (
  proposalId: string,
  body: {
    lines?: { id: string; quantity?: number; productId?: string; removed?: boolean }[]
    add?: { productId: string; quantity?: number }[]
  }
): Promise<RxProposal> => {
  const { data } = await api.put(`/rx-cart/proposals/${proposalId}/lines`, body)
  return data.data.proposal as RxProposal
}

/** Sends products for a note that was approved without them. */
export const confirmProposal = async (
  proposalId: string,
  body: Omit<RxConfirmation, 'proposalId'>
): Promise<RxCartResult> => {
  const { data } = await api.post(`/rx-cart/proposals/${proposalId}/confirm`, body)
  return data.data.rxCart as RxCartResult
}

// ── Patient ────────────────────────────────────────────────────────────

export type PatientDecision = 'PENDING' | 'ACCEPTED' | 'DECLINED'

export interface ShippingAddress {
  name: string | null
  line1: string
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
}

export interface OnFile {
  eligible: boolean
  reason: 'NO_CARD_ON_FILE' | 'NO_SHIPPING_ADDRESS' | null
  card: { brand: string; last4: string; expMonth: number | null; expYear: number | null } | null
  shippingAddress: ShippingAddress | null
}

export interface ShippingAddressInput {
  name: string
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
}

export const setItemDecision = async (
  itemId: string,
  decision: Exclude<PatientDecision, 'PENDING'>
): Promise<void> => {
  await api.patch(`/carts/items/${itemId}/decision`, { decision })
}

export const getOnFile = async (): Promise<OnFile> => {
  const { data } = await api.get('/carts/one-click')
  return data.data.onFile as OnFile
}

export const saveShippingAddress = async (input: ShippingAddressInput): Promise<OnFile> => {
  const { data } = await api.put('/carts/shipping-address', {
    ...input,
    line2: input.line2?.trim() ? input.line2 : undefined,
  })
  return data.data.onFile as OnFile
}

export interface OneClickResult {
  status: 'succeeded' | 'processing'
  invoiceId: string
  paymentIntentId: string
}

export const oneClickCheckout = async (): Promise<OneClickResult> => {
  const { data } = await api.post('/carts/one-click-checkout')
  return data.data as OneClickResult
}

/** The API's error code and message from an axios error, for recoverable UI states. */
export function apiErrorOf(err: unknown): { status?: number; code?: string; message: string } {
  const res = (err as { response?: { status?: number; data?: Record<string, unknown> } })?.response
  const body = res?.data ?? {}
  const nested = (body.error ?? {}) as Record<string, unknown>
  const code = (body.code ?? nested.code) as string | undefined
  const message = (body.message ?? nested.message) as string | undefined
  return {
    status: res?.status,
    code,
    message: message || 'Something went wrong. Please try again.',
  }
}

export const cardLabel = (card: OnFile['card']): string =>
  card ? `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}` : ''
