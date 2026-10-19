import { z } from 'zod'
import { MAX_ORDERS } from '../services/rxMappingService'

const id = z.string().trim().min(1).max(64)
const quantity = z.number().int().min(1).max(99)

export const idParamSchema = z.object({ id }).strict()
export const sessionIdParamSchema = z.object({ sessionId: id }).strict()
export const itemIdParamSchema = z.object({ itemId: id }).strict()

/**
 * The provider's explicit confirmation of the detected products (B5.2).
 * `acknowledged` must be literally true: the UI sends it only after the
 * provider ticks "I confirm these products for this patient".
 */
export const rxConfirmationSchema = z
  .object({
    proposalId: id,
    confirmedLineIds: z.array(id).max(MAX_ORDERS),
    acknowledged: z.literal(true, { message: 'Provider confirmation is required' }),
  })
  .strict()

/** POST /ai-scribe/session/:id/approve — "Approve & send". The body is optional. */
export const approveSessionSchema = z
  .object({
    clinicId: id.optional(),
    rxConfirmation: rxConfirmationSchema.optional(),
  })
  .strict()
  .optional()

/** PUT /rx-cart/proposals/:id/lines — edit before confirming. */
export const updateProposalLinesSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            id,
            quantity: quantity.optional(),
            productId: id.optional(),
            removed: z.boolean().optional(),
          })
          .strict()
      )
      .max(MAX_ORDERS)
      .optional(),
    add: z
      .array(z.object({ productId: id, quantity: quantity.optional() }).strict())
      .max(MAX_ORDERS)
      .optional(),
  })
  .strict()

/** POST /rx-cart/proposals/:id/confirm — send products after the note was approved. */
export const confirmProposalSchema = rxConfirmationSchema.omit({ proposalId: true })

/** PATCH /carts/items/:itemId/decision — patient accepts or declines a prescribed item. */
export const itemDecisionSchema = z.object({ decision: z.enum(['ACCEPTED', 'DECLINED']) }).strict()

/** PUT /carts/shipping-address — saved at booking for one-click checkout (B5.4). */
export const shippingAddressSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    line1: z.string().trim().min(1, 'Address line 1 is required').max(200),
    line2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().min(1, 'City is required').max(100),
    state: z.string().trim().min(1, 'State is required').max(50),
    postalCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/, 'Postal code is not valid'),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, 'Country must be a 2-letter code')
      .transform((c) => c.toUpperCase())
      .default('US'),
  })
  .strict()

export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>

const fulfillmentClass = z.enum([
  'SUPPLEMENT',
  'OTC',
  'AESTHETIC',
  'RX_NON_SCHEDULED',
  'RX_SCHEDULED',
])
const aliases = z.array(z.string().trim().min(1).max(100)).max(20)

/** POST /products — catalog fields, including the Rx→Cart classification. */
export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    sku: z.string().trim().max(64).optional().nullable(),
    price: z.coerce.number().min(0).max(1_000_000),
    taxApplicable: z.boolean().optional(),
    fulfillmentClass: fulfillmentClass.optional(),
    aliases: aliases.optional(),
  })
  .strict()

/** PUT /products/:id */
export const updateProductSchema = createProductSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
