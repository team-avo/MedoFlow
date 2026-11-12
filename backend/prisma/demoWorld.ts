/**
 * Demo clinic contents, shared by the dev seed (prisma/seed.ts, the "Demo
 * Clinic") and the demo stocking script (scripts/demo-stock-clinic.ts, a
 * clinic signed up live during a demo).
 *
 * Every function takes the Prisma client to use and is idempotent: rows are
 * upserted by their natural keys, so a second run changes nothing.
 *
 * Writes no encrypted columns (utils/fieldCrypto ENCRYPTED_FIELDS), so a
 * plain owner PrismaClient without the field-encryption keys is safe.
 */
import type { PrismaClient, ProductFulfillmentClass } from '@prisma/client'

export interface DemoProviderDef {
  firstName: string
  lastName: string
  email: string
  userId: string | null
}

export interface BookingWorldOptions {
  /** Use this existing location instead of creating "Main Clinical Facility". */
  locationId?: string
  /** Providers to create; default: Evelyn Chen (doctor@medoflow.test) + Marcus Patel. */
  providers?: DemoProviderDef[]
  /** Give new services and providers a URL slug (the seed relies on the migration backfill). */
  assignSlugs?: boolean
}

export interface BookingWorld {
  locationId: string
  disciplineId: string
  services: { id: string; name: string; duration: number; price: number }[]
  providers: { id: string; firstName: string; lastName: string; userId: string | null }[]
}

export const DEMO_SERVICES = [
  { name: 'New Patient Consultation', duration: 45, price: 180, notice: 60 },
  { name: 'Follow-up Visit', duration: 30, price: 120, notice: 60 },
  { name: 'Annual Wellness Exam', duration: 60, price: 220, notice: 120 },
  { name: 'Telehealth Check-in', duration: 20, price: 85, notice: 30 },
] as const

/** Same rules as site/services/slugService.slugify (and migration 20261020000000). */
export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return s || 'item'
}

/** A slug for `text` not in `taken` ("dr-lee", then "dr-lee-2", …); adds it to `taken`. */
export function freeSlug(text: string, taken: Set<string>): string {
  const base = slugify(text)
  let slug = base
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 56)}-${n}`
  taken.add(slug)
  return slug
}

async function takenSlugs(
  db: PrismaClient,
  entity: 'service' | 'provider' | 'product',
  clinicId: string
): Promise<Set<string>> {
  const where = { clinicId, slug: { not: null } }
  const rows =
    entity === 'service'
      ? await db.service.findMany({ where, select: { slug: true } })
      : entity === 'provider'
        ? await db.provider.findMany({ where, select: { slug: true } })
        : await db.product.findMany({ where, select: { slug: true } })
  return new Set(rows.map((r) => r.slug!))
}

export async function seedBookingWorld(
  db: PrismaClient,
  clinicId: string,
  opts: BookingWorldOptions = {}
): Promise<BookingWorld> {
  // Location — use a primary clinical facility so the front-end can default
  // to it when creating slot holds / appointments.
  const location = opts.locationId
    ? await db.location.findFirstOrThrow({ where: { id: opts.locationId, clinicId } })
    : await db.location.upsert({
        where: { id: `loc_${clinicId.slice(-8)}` },
        update: { isActive: true },
        create: {
          id: `loc_${clinicId.slice(-8)}`,
          clinicId,
          name: 'Main Clinical Facility',
          addressLine1: '1200 Health Plaza',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
          timezone: 'America/New_York',
          isActive: true,
        },
      })

  const discipline = await db.discipline.upsert({
    where: { clinicId_name: { clinicId, name: 'Primary Care' } },
    update: { isActive: true, isArchived: false },
    create: {
      clinicId,
      name: 'Primary Care',
      description: 'General adult medicine and wellness consultations.',
    },
  })

  const serviceSlugs = opts.assignSlugs ? await takenSlugs(db, 'service', clinicId) : null
  const services: BookingWorld['services'] = []
  for (const s of DEMO_SERVICES) {
    const existing = serviceSlugs
      ? await db.service.findUnique({
          where: { clinicId_name: { clinicId, name: s.name } },
          select: { slug: true },
        })
      : null
    const slug = serviceSlugs && !existing?.slug ? freeSlug(s.name, serviceSlugs) : undefined
    const svc = await db.service.upsert({
      where: { clinicId_name: { clinicId, name: s.name } },
      update: {
        duration: s.duration,
        defaultPrice: s.price,
        minimumNoticeMinutes: s.notice,
        isActive: true,
        isArchived: false,
        ...(slug ? { slug } : {}),
      },
      create: {
        clinicId,
        disciplineId: discipline.id,
        name: s.name,
        duration: s.duration,
        defaultPrice: s.price,
        minimumNoticeMinutes: s.notice,
        maxFutureBookingDays: 90,
        isActive: true,
        ...(slug ? { slug } : {}),
      },
    })
    services.push({ id: svc.id, name: svc.name, duration: s.duration, price: s.price })
  }

  // Providers — by default one linked to the doctor@medoflow.test user so the
  // provider has an authenticatable staff account, plus a second solo
  // provider so the "Any provider" flow has something to pick from.
  let providerDefs = opts.providers
  if (!providerDefs) {
    const doctorUser = await db.user.findUnique({ where: { email: 'doctor@medoflow.test' } })
    providerDefs = [
      {
        firstName: 'Evelyn',
        lastName: 'Chen',
        email: 'doctor@medoflow.test',
        userId: doctorUser?.id ?? null,
      },
      { firstName: 'Marcus', lastName: 'Patel', email: 'marcus.patel@medoflow.test', userId: null },
    ]
  }

  const providerSlugs = opts.assignSlugs ? await takenSlugs(db, 'provider', clinicId) : null
  const providers: BookingWorld['providers'] = []
  for (const def of providerDefs) {
    // Provider has no natural unique key other than (userId) when present,
    // so we find-or-create by name+clinic to stay idempotent.
    const existing = await db.provider.findFirst({
      where: { clinicId, firstName: def.firstName, lastName: def.lastName },
    })
    const provider =
      existing ??
      (await db.provider.create({
        data: {
          clinicId,
          userId: def.userId,
          firstName: def.firstName,
          lastName: def.lastName,
          email: def.email,
          isActive: true,
          ...(providerSlugs
            ? { slug: freeSlug(`${def.firstName} ${def.lastName}`, providerSlugs) }
            : {}),
        },
      }))
    providers.push({
      id: provider.id,
      firstName: provider.firstName,
      lastName: provider.lastName,
      userId: provider.userId,
    })

    // Attach the discipline.
    await db.providerDiscipline.upsert({
      where: { providerId_disciplineId: { providerId: provider.id, disciplineId: discipline.id } },
      update: {},
      create: { providerId: provider.id, disciplineId: discipline.id },
    })

    // Offer every service.
    for (const svc of services) {
      await db.providerService.upsert({
        where: { providerId_serviceId: { providerId: provider.id, serviceId: svc.id } },
        update: {},
        create: { providerId: provider.id, serviceId: svc.id },
      })
    }

    // Assign to the primary location.
    await db.providerLocationAssignment.upsert({
      where: { providerId_locationId: { providerId: provider.id, locationId: location.id } },
      update: { isPrimary: true },
      create: { providerId: provider.id, locationId: location.id, isPrimary: true },
    })

    // Availability — Monday–Friday, 9:00–17:00 local.
    const existingAvail = await db.providerAvailability.findMany({
      where: { providerId: provider.id },
      select: { weekday: true },
    })
    const haveWeekdays = new Set(existingAvail.map((a) => a.weekday))
    for (const weekday of [1, 2, 3, 4, 5]) {
      if (haveWeekdays.has(weekday)) continue
      await db.providerAvailability.create({
        data: {
          providerId: provider.id,
          locationId: location.id,
          weekday,
          startTime: '09:00',
          endTime: '17:00',
        },
      })
    }
  }

  return { locationId: location.id, disciplineId: discipline.id, services, providers }
}

export interface DemoProductDef {
  name: string
  desc: string
  sku: string | null
  price: number
  qty: number
  fulfillmentClass?: ProductFulfillmentClass
}

export const DEMO_PRODUCTS: readonly DemoProductDef[] = [
  {
    name: 'Daily Wellness Pack',
    desc: 'Comprehensive daily supplement bundle with essential vitamins, minerals, and antioxidants to support energy, immune function, and overall wellbeing.',
    sku: 'DWP-001',
    price: 32,
    qty: 40,
  },
  {
    name: 'Recovery Support Formula',
    desc: 'Post-treatment blend of magnesium, collagen peptides, and B-complex vitamins. Accelerates tissue recovery and reduces soreness after physiotherapy sessions.',
    sku: 'RSF-002',
    price: 45,
    qty: 30,
  },
  {
    name: 'Longevity Essentials',
    desc: 'Premium longevity-focused bundle with CoQ10, omega-3 fatty acids, vitamin D3, and resveratrol. Supports cardiovascular health and healthy aging.',
    sku: 'LE-003',
    price: 58,
    qty: 25,
  },
  {
    name: 'Sleep & Stress Support',
    desc: 'Evidence-based formula with ashwagandha, L-theanine, magnesium glycinate, and melatonin. Reduces cortisol and improves sleep quality.',
    sku: 'SSS-004',
    price: 38,
    qty: 35,
  },
  {
    name: 'Joint Mobility Support',
    desc: 'Advanced joint care complex with glucosamine, chondroitin, MSM, and turmeric extract. Recommended for patients in ongoing physiotherapy.',
    sku: 'JMS-005',
    price: 42,
    qty: 20,
  },
  {
    name: 'Electrolyte Performance Mix',
    desc: 'Pharmaceutical-grade electrolyte formula with sodium, potassium, and magnesium. Ideal for athletes and active recovery patients.',
    sku: 'EPM-006',
    price: 28,
    qty: 45,
  },
  {
    name: 'Magnesium Recovery Blend',
    desc: 'High-bioavailability magnesium glycinate + citrate complex. Supports muscle relaxation, sleep, and post-exercise recovery.',
    sku: 'MRB-007',
    price: 35,
    qty: 30,
  },
  {
    name: 'Mobility Roller Kit',
    desc: 'Professional-grade foam roller with trigger point ball and stretching guide. Extends the benefits of each physiotherapy session between appointments.',
    sku: 'MRK-008',
    price: 55,
    qty: 18,
  },
  {
    name: 'Medical-Grade Vitamin C Serum',
    desc: 'Dermatologist-formulated 15% L-ascorbic acid serum with vitamin E and ferulic acid. Brightens skin tone, reduces photodamage, and supports collagen synthesis. Fragrance-free, non-comedogenic.',
    sku: 'SKN-009',
    price: 68,
    qty: 22,
  },
  {
    name: 'Clinical SPF 50 Sunscreen',
    desc: 'Broad-spectrum UVA/UVB zinc-oxide sunscreen developed for sensitive and post-procedure skin. Mineral-based, reef-safe, non-whitening on medium-to-deep skin tones.',
    sku: 'SKN-010',
    price: 34,
    qty: 40,
  },
  {
    name: 'Prenatal Advanced Formula',
    desc: 'Methylated folate, choline, DHA, iron bisglycinate, and iodine in clinically-reviewed ratios. Supports maternal health and fetal neural development through every trimester.',
    sku: 'WMN-011',
    price: 52,
    qty: 18,
  },
  {
    name: 'Clinical Probiotic Complex',
    desc: '50B CFU, 12-strain probiotic with prebiotic fiber. Shelf-stable, acid-resistant capsules designed to restore gut flora after antibiotic courses or IBS flare-ups.',
    sku: 'GUT-012',
    price: 48,
    qty: 28,
  },
  {
    name: 'Immune Defense Stack',
    desc: 'Quercetin, zinc picolinate, vitamin C, vitamin D3, and elderberry. Evidence-based daily immune support — especially through travel and seasonal transitions.',
    sku: 'IMM-013',
    price: 44,
    qty: 32,
  },
  {
    name: 'At-Home Blood Pressure Monitor',
    desc: 'FDA-cleared upper-arm BP monitor with Bluetooth sync to the MedoFlow patient app. Stores 120 readings per user, two-user memory, large backlit display.',
    sku: 'DIA-014',
    price: 89,
    qty: 15,
  },
  {
    name: 'Metabolic Support Formula',
    desc: 'Berberine HCl 500mg, cinnamon bark, chromium, and alpha-lipoic acid. Supports healthy blood sugar regulation and insulin sensitivity alongside lifestyle changes.',
    sku: 'MET-015',
    price: 46,
    qty: 24,
  },
  {
    name: 'Whey Isolate Protein (Unflavored)',
    desc: 'Cold-filtered grass-fed whey isolate — 27g protein per scoop, no added sugar, no artificial flavors. Clinically appropriate for sarcopenia prevention and post-rehab recomposition.',
    sku: 'FIT-016',
    price: 54,
    qty: 35,
  },
]

/**
 * The products the AI-scribe demo conversation names (demo script §4A/§5):
 * matched to the cart, removed live, routed to e-prescribe, and the one left
 * deliberately unmatched ("turmeric complex") for the provider to map. No SKU
 * and no aliases, so matching depends on the names alone.
 */
export const SCRIBE_DEMO_PRODUCTS: readonly DemoProductDef[] = [
  {
    name: 'Magnesium Glycinate',
    desc: 'Gentle, well-absorbed magnesium for muscle tension and sleep.',
    sku: null,
    price: 24,
    qty: 30,
    fulfillmentClass: 'SUPPLEMENT',
  },
  {
    name: 'Arnica Gel',
    desc: 'Topical arnica gel for bruising and sore muscles.',
    sku: null,
    price: 14,
    qty: 30,
    fulfillmentClass: 'OTC',
  },
  {
    name: 'Tramadol',
    desc: 'Prescription pain relief. Dispensed by e-prescription only.',
    sku: null,
    price: 18,
    qty: 0,
    fulfillmentClass: 'RX_SCHEDULED',
  },
  {
    name: 'Golden Turmeric Blend',
    desc: 'Turmeric and black pepper supplement for everyday joint comfort.',
    sku: null,
    price: 29,
    qty: 30,
    fulfillmentClass: 'SUPPLEMENT',
  },
]

export const DEMO_PACKAGES = [
  {
    name: '3-Session Recovery Package',
    desc: 'Three focused physiotherapy sessions for targeted acute recovery. Ideal for patients returning from injury or beginning a structured rehabilitation cycle.',
    price: 210,
    sessions: 3,
    days: 90,
  },
  {
    name: '6-Session Performance Package',
    desc: 'Six sessions combining physiotherapy, movement assessment, and performance coaching. Best for athletes and active individuals committed to functional improvement.',
    price: 390,
    sessions: 6,
    days: 180,
  },
  {
    name: '10-Session Physio Rehab Package',
    desc: 'Comprehensive 10-session physiotherapy program for complex rehabilitation, post-surgical recovery, or long-term chronic condition management.',
    price: 620,
    sessions: 10,
    days: 365,
  },
] as const

export const DEMO_MEMBERSHIPS = [
  {
    name: 'Monthly Wellness Membership',
    desc: 'Monthly clinic membership with 15% service discount, priority booking access, and quarterly health check-in. Cancel anytime.',
    price: 49,
    discount: 15,
  },
  {
    name: 'Premium Longevity Membership',
    desc: 'Our highest-tier membership. 25% service discount, dedicated care coordination, monthly body composition review, and unlimited same-day booking.',
    price: 89,
    discount: 25,
  },
] as const

export interface CatalogueOptions {
  /** Added after DEMO_PRODUCTS (e.g. SCRIBE_DEMO_PRODUCTS). */
  extraProducts?: readonly DemoProductDef[]
  /** Give new products a URL slug (the seed relies on the migration backfill). */
  assignSlugs?: boolean
}

export async function seedCatalogue(
  db: PrismaClient,
  clinicId: string,
  opts: CatalogueOptions = {}
): Promise<void> {
  const productSlugs = opts.assignSlugs ? await takenSlugs(db, 'product', clinicId) : null
  for (const p of [...DEMO_PRODUCTS, ...(opts.extraProducts ?? [])]) {
    const existing = productSlugs
      ? await db.product.findUnique({
          where: { clinicId_name: { clinicId, name: p.name } },
          select: { slug: true },
        })
      : null
    const slug = productSlugs && !existing?.slug ? freeSlug(p.name, productSlugs) : undefined
    const cls = p.fulfillmentClass ? { fulfillmentClass: p.fulfillmentClass } : {}
    const product = await db.product.upsert({
      where: { clinicId_name: { clinicId, name: p.name } },
      update: {
        description: p.desc,
        sku: p.sku,
        price: p.price,
        isActive: true,
        ...cls,
        ...(slug ? { slug } : {}),
      },
      create: {
        clinicId,
        name: p.name,
        description: p.desc,
        sku: p.sku,
        price: p.price,
        isActive: true,
        ...cls,
        ...(slug ? { slug } : {}),
      },
    })
    await db.inventoryItem.upsert({
      where: { productId: product.id },
      update: { quantityInStock: p.qty, reorderThreshold: 8 },
      create: { clinicId, productId: product.id, quantityInStock: p.qty, reorderThreshold: 8 },
    })
  }

  for (const pkg of DEMO_PACKAGES) {
    await db.package.upsert({
      where: { clinicId_name: { clinicId, name: pkg.name } },
      update: {
        description: pkg.desc,
        price: pkg.price,
        totalSessions: pkg.sessions,
        expiresInDays: pkg.days,
        isActive: true,
      },
      create: {
        clinicId,
        name: pkg.name,
        description: pkg.desc,
        price: pkg.price,
        totalSessions: pkg.sessions,
        expiresInDays: pkg.days,
        isActive: true,
      },
    })
  }

  for (const m of DEMO_MEMBERSHIPS) {
    await db.membership.upsert({
      where: { clinicId_name: { clinicId, name: m.name } },
      update: {
        description: m.desc,
        monthlyPrice: m.price,
        serviceDiscountPercent: m.discount,
        isActive: true,
      },
      create: {
        clinicId,
        name: m.name,
        description: m.desc,
        monthlyPrice: m.price,
        billingPeriod: 'MONTHLY',
        serviceDiscountPercent: m.discount,
        isActive: true,
      },
    })
  }
}
