/** CTO-40: request bodies for store connections and catalog imports. */
import { z } from 'zod'
import { MAPPED_FIELDS } from '../services/catalogImport/presets'

/** Classes a person may pick for an imported product (never UNCLASSIFIED). */
export const pickableClass = z.enum([
  'SUPPLEMENT',
  'OTC',
  'AESTHETIC',
  'RX_NON_SCHEDULED',
  'RX_SCHEDULED',
])

export const providerParamSchema = z
  .object({ provider: z.enum(['shopify', 'square', 'woocommerce', 'wix']) })
  .strict()

export const startConnectionSchema = z
  .object({
    shop: z.string().trim().max(200).optional(),
    storeUrl: z.string().trim().max(500).optional(),
  })
  .strict()

/** The query string the provider sent the browser back with. */
export const completeConnectionSchema = z
  .object({ query: z.record(z.string().max(100), z.string().max(4_000)) })
  .strict()

export const wooKeySchema = z
  .object({
    storeUrl: z.string().trim().min(4).max(500),
    consumerKey: z.string().trim().min(10).max(100),
    consumerSecret: z.string().trim().min(10).max(100),
  })
  .strict()

export const wixKeySchema = z
  .object({
    siteId: z.string().trim().min(10).max(64),
    apiKey: z.string().trim().min(20).max(4_000),
    label: z.string().trim().max(120).optional(),
  })
  .strict()

/** WooCommerce's key callback. Unknown keys are ignored. */
export const wooCallbackSchema = z.object({
  key_id: z.union([z.number(), z.string()]).optional(),
  user_id: z.string().max(2_000),
  consumer_key: z.string().max(100),
  consumer_secret: z.string().max(100),
  key_permissions: z.string().max(20).optional(),
})

const options = z
  .object({ syncStock: z.boolean().optional(), syncPrice: z.boolean().optional() })
  .strict()

export const startImportSchema = z
  .object({ connectionId: z.string().min(1).max(40), options: options.optional() })
  .strict()

const mapping = z
  .object(Object.fromEntries(MAPPED_FIELDS.map((f) => [f, z.string().max(200).optional()])))
  .strict()

/** Multipart text fields; mapping and options arrive as JSON strings. */
export const fileImportFieldsSchema = z
  .object({
    preset: z
      .enum(['auto', 'shopify_csv', 'wix_csv', 'square_items', 'woocommerce_csv', 'generic'])
      .optional(),
    mapping: z
      .string()
      .max(5_000)
      .optional()
      .transform((s, ctx) => {
        if (!s) return undefined
        try {
          return mapping.parse(JSON.parse(s))
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Invalid column mapping' })
          return z.NEVER
        }
      }),
    options: z
      .string()
      .max(500)
      .optional()
      .transform((s, ctx) => {
        if (!s) return undefined
        try {
          return options.parse(JSON.parse(s))
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Invalid options' })
          return z.NEVER
        }
      }),
  })
  .strict()

export const editImportSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            skipped: z.boolean().optional(),
            nameOverride: z.string().trim().max(200).nullable().optional(),
            chosenClass: pickableClass.nullable().optional(),
          })
          .strict()
      )
      .max(500)
      .optional(),
    bulk: z
      .object({
        rowIds: z.array(z.string().min(1).max(40)).max(5_000).optional(),
        acceptSuggestions: z.boolean().optional(),
        chosenClass: pickableClass.nullable().optional(),
        skipped: z.boolean().optional(),
      })
      .strict()
      .optional(),
    options: options.optional(),
  })
  .strict()

export const rowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  filter: z
    .enum(['all', 'create', 'update', 'unchanged', 'conflict', 'error', 'skipped', 'unclassified'])
    .default('all'),
})
