/**
 * Client-side validation for the shipping address saved at booking (F5.3) —
 * the mirror of shippingAddressSchema in backend/src/validation/rxCartSchemas.ts.
 * Both suites run shared/validation-cases/commerce.json.
 */
import { z } from 'zod'

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

export type ShippingAddressValues = z.input<typeof shippingAddressSchema>
