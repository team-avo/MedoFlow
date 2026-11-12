/**
 * Medoflow: Full Demo Universe Seed
 *
 * Creates "Everwell Longevity Clinic" with a complete, believable demo world:
 *   4 providers, 15 patients, ~61 appointments, full invoicing, payments,
 *   commission records, visit records, AI scribe sessions, packages, memberships,
 *   plus the AI Front Desk (voice agent) config and a sample call log.
 *
 * Idempotency:
 *   Catalog items, users, providers: upsert / findFirst guard.
 *   Appointments, invoices, payments, commission records: guarded by appointment
 *   count: skipped if the clinic already has appointments.
 *   Voice agent: config upserted on unique clinicId; call log guarded by call count.
 *   Re-running is safe for catalog/user data.
 *
 * Prerequisites:
 *   cd backend
 *   npx prisma generate        (Prisma client must be generated)
 *   npx prisma migrate deploy  (or prisma db push for dev)
 *
 * Run:
 *   cd backend
 *   npm run seed:demo
 *   # or directly:
 *   npx ts-node prisma/seed_demo.ts
 */

import {
  Prisma,
  PrismaClient,
  Role,
  AppointmentStatus,
  PaymentStatus,
  InvoiceStatus,
  CommissionStatus,
  AIScribeStatus,
  PackageStatus,
  SubscriptionStatus,
  CommissionType,
  CommissionItemType,
  VoicePersona,
  VoiceCallStatus,
  VoiceCallChannel,
  VoiceCallOutcome,
} from '@prisma/client'
import * as argon2 from 'argon2'

const prisma = new PrismaClient()

const DEMO_CLINIC_NAME = 'Everwell Longevity Clinic'
const DEMO_PASSWORD = 'Demo1234!'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysFromNow(days: number, hour = 10, minute = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, minute, 0, 0)
  return d
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

function decimal(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Schema: apply any missing columns before seeding
// ---------------------------------------------------------------------------

async function setupMissingColumns(): Promise<void> {
  const stmts = [
    `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paymentChannel" TEXT`,
    `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT`,
    `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "recordedById" TEXT`,
    `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "recordedAt" TIMESTAMP(3)`,
    `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
    `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT`,
    `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT`,
    `ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "stripeClientSecret" TEXT`,
    `ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "serviceDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "stripeInvoiceId" TEXT`,
    `ALTER TABLE "PatientSubscription" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT`,
    `ALTER TABLE "ConsultationSession" ADD COLUMN IF NOT EXISTS "joinTokenExpiresAt" TIMESTAMP(3)`,
  ]
  for (const sql of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql)
    } catch {
      // Column already exists or table not yet present, safe to continue.
    }
  }
  const indices = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "Payment_stripeRefundId_key" ON "Payment"("stripeRefundId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId")`,
  ]
  for (const sql of indices) {
    try {
      await prisma.$executeRawUnsafe(sql)
    } catch {
      /* already exists */
    }
  }
  console.log('  ✓ Schema columns ensured')
}

// ---------------------------------------------------------------------------
// Phase 1: Clinic & Location
// ---------------------------------------------------------------------------

async function upsertClinic() {
  let clinic = await prisma.clinic.findFirst({ where: { name: DEMO_CLINIC_NAME } })
  if (!clinic) {
    // Ensure a tenant exists to attach this demo clinic to. `tenant_default`
    // is created by the 20260419000000_add_tenant_model migration.
    await prisma.tenant.upsert({
      where: { id: 'tenant_default' },
      update: {},
      create: {
        id: 'tenant_default',
        name: 'Default Tenant',
        slug: 'default',
        verificationStatus: 'APPROVED',
      },
    })
    clinic = await prisma.clinic.create({
      data: {
        name: DEMO_CLINIC_NAME,
        email: 'hello@everwell.demo',
        subscriptionPlan: 'professional',
        aiEnabled: true,
        tenantId: 'tenant_default',
      },
    })
    console.log(`  ✓ Clinic created: ${clinic.name}`)
  } else {
    console.log(`  ✓ Clinic found: ${clinic.name}`)
  }
  return clinic
}

async function upsertLocation(clinicId: string) {
  const existing = await prisma.location.findFirst({
    where: { clinicId, name: 'Main Clinic' },
  })
  if (existing) return existing
  const location = await prisma.location.create({
    data: {
      clinicId,
      name: 'Main Clinic',
      address: '1200 Wellness Drive, Suite 100',
      timezone: 'America/Los_Angeles',
      isActive: true,
    },
  })
  console.log(`  ✓ Location: ${location.name}`)
  return location
}

// ---------------------------------------------------------------------------
// Phase 2: Disciplines
// ---------------------------------------------------------------------------

async function createDisciplines(clinicId: string) {
  const defs = [
    { name: 'Physiotherapy', description: 'Movement restoration and rehabilitation' },
    { name: 'Sports Medicine', description: 'Injury management and athletic performance' },
    { name: 'Nutrition & Wellness', description: 'Dietary guidance and wellness optimization' },
    { name: 'Mental Performance', description: 'Cognitive coaching and stress resilience' },
  ]
  const map: Record<string, { id: string; name: string }> = {}
  for (const d of defs) {
    const disc = await prisma.discipline.upsert({
      where: { clinicId_name: { clinicId, name: d.name } },
      update: {},
      create: { clinicId, name: d.name, description: d.description, isActive: true },
    })
    map[d.name] = disc
  }
  console.log(`  ✓ Disciplines: ${Object.keys(map).join(', ')}`)
  return map
}

// ---------------------------------------------------------------------------
// Phase 3: Services
// ---------------------------------------------------------------------------

async function createServices(clinicId: string, disciplines: Record<string, { id: string }>) {
  const defs = [
    // Physiotherapy
    {
      discipline: 'Physiotherapy',
      name: 'Initial Physiotherapy Assessment',
      duration: 60,
      price: 150,
    },
    {
      discipline: 'Physiotherapy',
      name: 'Follow-up Physiotherapy Session',
      duration: 30,
      price: 80,
    },
    {
      discipline: 'Physiotherapy',
      name: 'Postural Assessment & Correction',
      duration: 60,
      price: 125,
    },
    // Sports Medicine
    {
      discipline: 'Sports Medicine',
      name: 'Sports Injury Rehabilitation',
      duration: 60,
      price: 130,
    },
    {
      discipline: 'Sports Medicine',
      name: 'Performance Movement Screen',
      duration: 45,
      price: 110,
    },
    {
      discipline: 'Sports Medicine',
      name: 'Recovery & Regeneration Session',
      duration: 45,
      price: 95,
    },
    { discipline: 'Sports Medicine', name: 'Sports Massage Therapy', duration: 45, price: 90 },
    {
      discipline: 'Sports Medicine',
      name: 'Functional Strength Assessment',
      duration: 45,
      price: 100,
    },
    // Nutrition & Wellness
    {
      discipline: 'Nutrition & Wellness',
      name: 'Comprehensive Nutrition Consultation',
      duration: 60,
      price: 120,
    },
    {
      discipline: 'Nutrition & Wellness',
      name: 'Follow-up Nutrition Session',
      duration: 30,
      price: 75,
    },
    {
      discipline: 'Nutrition & Wellness',
      name: 'Sleep Optimization Consultation',
      duration: 45,
      price: 115,
    },
    // Mental Performance
    {
      discipline: 'Mental Performance',
      name: 'Mental Performance Coaching',
      duration: 60,
      price: 135,
    },
  ]
  const map: Record<string, { id: string; name: string; defaultPrice: unknown; duration: number }> =
    {}
  for (const s of defs) {
    const svc = await prisma.service.upsert({
      where: { clinicId_name: { clinicId, name: s.name } },
      update: {},
      create: {
        clinicId,
        disciplineId: disciplines[s.discipline]!.id,
        name: s.name,
        duration: s.duration,
        defaultPrice: s.price,
        taxApplicable: false,
        isActive: true,
      },
    })
    map[s.name] = svc
  }
  console.log(`  ✓ Services: ${Object.keys(map).length} created/found`)
  return map
}

// ---------------------------------------------------------------------------
// Phase 4: Products, Packages, Memberships
// ---------------------------------------------------------------------------

async function createProducts(clinicId: string) {
  const defs = [
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
      desc: 'Quercetin, zinc picolinate, vitamin C, vitamin D3, and elderberry. Evidence-based daily immune support, especially through travel and seasonal transitions.',
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
      desc: 'Cold-filtered grass-fed whey isolate: 27g protein per scoop, no added sugar, no artificial flavors. Clinically appropriate for sarcopenia prevention and post-rehab recomposition.',
      sku: 'FIT-016',
      price: 54,
      qty: 35,
    },
  ]
  const map: Record<string, { id: string; name: string; price: unknown }> = {}
  for (const p of defs) {
    const product = await prisma.product.upsert({
      where: { clinicId_name: { clinicId, name: p.name } },
      update: {},
      create: {
        clinicId,
        name: p.name,
        description: p.desc,
        sku: p.sku,
        price: p.price,
        isActive: true,
      },
    })
    await prisma.inventoryItem.upsert({
      where: { productId: product.id },
      update: {},
      create: { clinicId, productId: product.id, quantityInStock: p.qty, reorderThreshold: 8 },
    })
    map[p.name] = product
  }
  console.log(`  ✓ Products: ${Object.keys(map).length} created/found`)
  return map
}

async function createPackages(clinicId: string) {
  const defs = [
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
  ]
  const map: Record<
    string,
    { id: string; name: string; price: unknown; totalSessions: number | null }
  > = {}
  for (const p of defs) {
    const pkg = await prisma.package.upsert({
      where: { clinicId_name: { clinicId, name: p.name } },
      update: {},
      create: {
        clinicId,
        name: p.name,
        description: p.desc,
        price: p.price,
        totalSessions: p.sessions,
        expiresInDays: p.days,
        isActive: true,
      },
    })
    map[p.name] = pkg
  }
  console.log(`  ✓ Packages: ${Object.keys(map).length} created/found`)
  return map
}

async function createMemberships(clinicId: string) {
  const defs = [
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
  ]
  const map: Record<string, { id: string; name: string; monthlyPrice: unknown }> = {}
  for (const m of defs) {
    const membership = await prisma.membership.upsert({
      where: { clinicId_name: { clinicId, name: m.name } },
      update: {},
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
    map[m.name] = membership
  }
  console.log(`  ✓ Memberships: ${Object.keys(map).length} created/found`)
  return map
}

// ---------------------------------------------------------------------------
// Phase 5: Users
// ---------------------------------------------------------------------------

async function createUsers(clinicId: string, passwordHash: string) {
  // A sample custom role, so the STAFF (custom-role) path is testable end to end.
  const coordinatorRole = await prisma.customRole.upsert({
    where: { clinicId_name: { clinicId, name: 'Clinic Coordinator' } },
    update: {},
    create: {
      clinicId,
      name: 'Clinic Coordinator',
      description:
        'Front-of-house coordinator: scheduling + patient management, no billing access.',
      permissions: [
        'appointments.view',
        'appointments.manage',
        'patients.view',
        'patients.manage',
        'forms.manage',
      ],
      isActive: true,
    },
  })

  type UserDef = {
    email: string
    name: string
    role: Role
    clinicIdOverride?: string | null // undefined → this clinic; null → cross-tenant (platform admin)
    customRoleId?: string
  }

  const defs: UserDef[] = [
    // Platform operator: cross-tenant, not tied to a clinic
    {
      email: 'platform@medoflow.demo',
      name: 'Pat Okafor',
      role: 'PLATFORM_ADMIN',
      clinicIdOverride: null,
    },
    // Clinic staff: one account per system role
    { email: 'alex@everwell.demo', name: 'Alex Thornton', role: 'SUPER_ADMIN' },
    { email: 'jordan@everwell.demo', name: 'Jordan Walsh', role: 'FRONT_DESK' },
    { email: 'taylor@everwell.demo', name: 'Taylor Brooks', role: 'ACCOUNTING' },
    { email: 'casey@everwell.demo', name: 'Casey Morgan', role: 'MARKETING' },
    {
      email: 'robin@everwell.demo',
      name: 'Robin Lee',
      role: 'STAFF',
      customRoleId: coordinatorRole.id,
    },
    // Provider users
    { email: 'sarah@everwell.demo', name: 'Dr. Sarah Chen', role: 'PROVIDER' },
    { email: 'marcus@everwell.demo', name: 'Dr. Marcus Rivera', role: 'PROVIDER' },
    { email: 'priya@everwell.demo', name: 'Dr. Priya Patel', role: 'PROVIDER' },
    { email: 'james@everwell.demo', name: 'Coach James Wright', role: 'PROVIDER' },
    // Patients
    { email: 'emma@everwell.demo', name: 'Emma Hartwell', role: 'PATIENT' },
    { email: 'liam@everwell.demo', name: 'Liam Nakamura', role: 'PATIENT' },
    { email: 'sophia@everwell.demo', name: 'Sophia Martinez', role: 'PATIENT' },
    { email: 'marcus.chen@everwell.demo', name: 'Marcus Chen', role: 'PATIENT' },
    { email: 'isabella@everwell.demo', name: 'Isabella Torres', role: 'PATIENT' },
    { email: 'ryan@everwell.demo', name: 'Ryan Thompson', role: 'PATIENT' },
    { email: 'olivia@everwell.demo', name: 'Olivia Park', role: 'PATIENT' },
    { email: 'noah@everwell.demo', name: 'Noah Williams', role: 'PATIENT' },
    { email: 'ava@everwell.demo', name: 'Ava Johnson', role: 'PATIENT' },
    { email: 'ethan@everwell.demo', name: 'Ethan Brown', role: 'PATIENT' },
    { email: 'mia@everwell.demo', name: 'Mia Davis', role: 'PATIENT' },
    { email: 'lucas@everwell.demo', name: 'Lucas Wilson', role: 'PATIENT' },
    { email: 'charlotte@everwell.demo', name: 'Charlotte Moore', role: 'PATIENT' },
    { email: 'benjamin@everwell.demo', name: 'Benjamin Taylor', role: 'PATIENT' },
    { email: 'zoe@everwell.demo', name: 'Zoe Anderson', role: 'PATIENT' },
  ]
  const map: Record<string, { id: string; name: string; email: string; role: string }> = {}
  for (const u of defs) {
    const cid = u.clinicIdOverride === undefined ? clinicId : u.clinicIdOverride
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, clinicId: cid, role: u.role, customRoleId: u.customRoleId ?? null },
      create: {
        email: u.email,
        name: u.name,
        password: passwordHash,
        role: u.role,
        clinicId: cid,
        customRoleId: u.customRoleId ?? null,
      },
    })
    map[u.email] = user
  }
  console.log(`  ✓ Users: ${Object.keys(map).length} upserted (all 8 roles)`)
  return map
}

// ---------------------------------------------------------------------------
// Phase 6: Providers
// ---------------------------------------------------------------------------

async function createProviders(
  clinicId: string,
  users: Record<string, { id: string }>,
  disciplines: Record<string, { id: string }>,
  services: Record<string, { id: string }>,
  locationId: string
) {
  const defs = [
    {
      email: 'sarah@everwell.demo',
      firstName: 'Sarah',
      lastName: 'Chen',
      disciplines: ['Physiotherapy', 'Sports Medicine'],
      services: [
        'Initial Physiotherapy Assessment',
        'Follow-up Physiotherapy Session',
        'Postural Assessment & Correction',
        'Sports Massage Therapy',
      ],
      availability: [
        { weekday: 1, start: '08:00', end: '17:00' },
        { weekday: 2, start: '08:00', end: '17:00' },
        { weekday: 3, start: '08:00', end: '17:00' },
        { weekday: 4, start: '08:00', end: '17:00' },
        { weekday: 5, start: '08:00', end: '15:00' },
      ],
    },
    {
      email: 'marcus@everwell.demo',
      firstName: 'Marcus',
      lastName: 'Rivera',
      disciplines: ['Sports Medicine'],
      services: [
        'Sports Injury Rehabilitation',
        'Performance Movement Screen',
        'Recovery & Regeneration Session',
        'Sports Massage Therapy',
        'Functional Strength Assessment',
      ],
      availability: [
        { weekday: 1, start: '07:00', end: '18:00' },
        { weekday: 2, start: '07:00', end: '18:00' },
        { weekday: 3, start: '07:00', end: '18:00' },
        { weekday: 4, start: '07:00', end: '18:00' },
        { weekday: 5, start: '07:00', end: '16:00' },
        { weekday: 6, start: '09:00', end: '13:00' },
      ],
    },
    {
      email: 'priya@everwell.demo',
      firstName: 'Priya',
      lastName: 'Patel',
      disciplines: ['Nutrition & Wellness'],
      services: [
        'Comprehensive Nutrition Consultation',
        'Follow-up Nutrition Session',
        'Sleep Optimization Consultation',
      ],
      availability: [
        { weekday: 1, start: '09:00', end: '17:00' },
        { weekday: 2, start: '09:00', end: '17:00' },
        { weekday: 4, start: '09:00', end: '17:00' },
        { weekday: 5, start: '09:00', end: '15:00' },
      ],
    },
    {
      email: 'james@everwell.demo',
      firstName: 'James',
      lastName: 'Wright',
      disciplines: ['Mental Performance', 'Nutrition & Wellness'],
      services: ['Mental Performance Coaching', 'Follow-up Nutrition Session'],
      availability: [
        { weekday: 2, start: '10:00', end: '16:00' },
        { weekday: 3, start: '10:00', end: '16:00' },
        { weekday: 5, start: '10:00', end: '15:00' },
      ],
    },
  ]

  const map: Record<string, { id: string; firstName: string; lastName: string }> = {}

  for (const def of defs) {
    const userId = users[def.email]?.id
    if (!userId) throw new Error(`User not found for ${def.email}`)

    let provider = await prisma.provider.findFirst({ where: { userId } })
    if (!provider) {
      provider = await prisma.provider.create({
        data: {
          clinicId,
          userId,
          firstName: def.firstName,
          lastName: def.lastName,
          email: def.email,
          isActive: true,
          bufferMinutes: 5,
        },
      })
    }

    // Disciplines
    for (const dName of def.disciplines) {
      const disc = disciplines[dName]
      if (disc) {
        await prisma.providerDiscipline.upsert({
          where: { providerId_disciplineId: { providerId: provider.id, disciplineId: disc.id } },
          update: {},
          create: { providerId: provider.id, disciplineId: disc.id },
        })
      }
    }

    // Services
    for (const sName of def.services) {
      const svc = services[sName]
      if (svc) {
        await prisma.providerService.upsert({
          where: { providerId_serviceId: { providerId: provider.id, serviceId: svc.id } },
          update: {},
          create: { providerId: provider.id, serviceId: svc.id },
        })
      }
    }

    // Availability (idempotent: skip if weekday already set)
    for (const av of def.availability) {
      const existing = await prisma.providerAvailability.findFirst({
        where: { providerId: provider.id, weekday: av.weekday },
      })
      if (!existing) {
        await prisma.providerAvailability.create({
          data: {
            providerId: provider.id,
            locationId,
            weekday: av.weekday,
            startTime: av.start,
            endTime: av.end,
          },
        })
      }
    }

    // Location assignment
    await prisma.providerLocationAssignment.upsert({
      where: { providerId_locationId: { providerId: provider.id, locationId } },
      update: {},
      create: { providerId: provider.id, locationId, isPrimary: true },
    })

    map[def.email] = provider
  }

  console.log(
    `  ✓ Providers: ${Object.keys(map).length} created/found with disciplines, services, availability`
  )
  return map
}

// ---------------------------------------------------------------------------
// Phase 7: Commission Rules
// ---------------------------------------------------------------------------

async function createCommissionRules(clinicId: string, providers: Record<string, { id: string }>) {
  const defs = [
    { email: 'sarah@everwell.demo', rate: 35 },
    { email: 'marcus@everwell.demo', rate: 30 },
    { email: 'priya@everwell.demo', rate: 25 },
    { email: 'james@everwell.demo', rate: 20 },
  ]
  const map: Record<string, { id: string; commissionValue: unknown }> = {}
  for (const d of defs) {
    const provider = providers[d.email]
    if (!provider) continue
    const existing = await prisma.commissionRule.findFirst({
      where: { clinicId, providerId: provider.id },
    })
    if (existing) {
      map[d.email] = existing
      continue
    }
    const rule = await prisma.commissionRule.create({
      data: {
        clinicId,
        providerId: provider.id,
        itemType: CommissionItemType.ALL,
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: d.rate,
        isActive: true,
      },
    })
    map[d.email] = rule
  }
  console.log(`  ✓ Commission rules: ${Object.keys(map).length} created/found`)
  return map
}

// ---------------------------------------------------------------------------
// Phase 8: Clinical History
// ---------------------------------------------------------------------------

interface ApptDef {
  patient: string // user email
  provider: string // user email (maps to provider via userId)
  service: string // service name
  daysOffset: number // negative = past, positive = future
  hour: number
  status: 'COMPLETED' | 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW'
  product?: string // optional product add-on to invoice
  isOutstanding?: true // COMPLETED but leave invoice unpaid (FINALIZED)
  isFullRefund?: true // COMPLETED, paid, then fully refunded
  isPartialRefund?: true // COMPLETED, paid, then 50% refunded
  isPartialPayment?: true // COMPLETED, partial payment only
  isHeroFinalVisit?: true // create FINAL VisitRecord + APPROVED AI scribe + published summary
  isHeroDraftVisit?: true // create DRAFT VisitRecord + DRAFT_GENERATED AI scribe
}

const APPOINTMENT_DEFS: ApptDef[] = [
  // -------------------------------------------------------------------------
  // Dr. Sarah Chen: Physiotherapy / high-value
  // -------------------------------------------------------------------------
  {
    patient: 'emma@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Initial Physiotherapy Assessment',
    daysOffset: -58,
    hour: 9,
    status: 'COMPLETED',
    product: 'Recovery Support Formula',
    isHeroFinalVisit: true,
  },
  {
    patient: 'emma@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Follow-up Physiotherapy Session',
    daysOffset: -45,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'emma@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Follow-up Physiotherapy Session',
    daysOffset: -32,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'sophia@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Initial Physiotherapy Assessment',
    daysOffset: -55,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'sophia@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Follow-up Physiotherapy Session',
    daysOffset: -42,
    hour: 9,
    status: 'COMPLETED',
    isFullRefund: true,
  },
  {
    patient: 'ryan@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Initial Physiotherapy Assessment',
    daysOffset: -38,
    hour: 13,
    status: 'COMPLETED',
  },
  {
    patient: 'ryan@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Postural Assessment & Correction',
    daysOffset: -28,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'olivia@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Follow-up Physiotherapy Session',
    daysOffset: -22,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'noah@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Initial Physiotherapy Assessment',
    daysOffset: -15,
    hour: 9,
    status: 'COMPLETED',
    product: 'Daily Wellness Pack',
  },
  {
    patient: 'ava@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Follow-up Physiotherapy Session',
    daysOffset: -10,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'ethan@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Postural Assessment & Correction',
    daysOffset: -7,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'charlotte@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Initial Physiotherapy Assessment',
    daysOffset: -4,
    hour: 9,
    status: 'COMPLETED',
    product: 'Joint Mobility Support',
  },
  {
    patient: 'liam@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Follow-up Physiotherapy Session',
    daysOffset: -35,
    hour: 13,
    status: 'COMPLETED',
    isOutstanding: true,
  },
  {
    patient: 'mia@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Initial Physiotherapy Assessment',
    daysOffset: -20,
    hour: 10,
    status: 'CANCELLED',
  },
  {
    patient: 'lucas@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Follow-up Physiotherapy Session',
    daysOffset: -12,
    hour: 15,
    status: 'NO_SHOW',
  },
  // Upcoming (CONFIRMED)
  {
    patient: 'emma@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Follow-up Physiotherapy Session',
    daysOffset: 7,
    hour: 10,
    status: 'CONFIRMED',
    isHeroDraftVisit: true,
  },
  {
    patient: 'emma@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Postural Assessment & Correction',
    daysOffset: 21,
    hour: 10,
    status: 'CONFIRMED',
  },
  {
    patient: 'sophia@everwell.demo',
    provider: 'sarah@everwell.demo',
    service: 'Postural Assessment & Correction',
    daysOffset: 14,
    hour: 11,
    status: 'CONFIRMED',
  },

  // -------------------------------------------------------------------------
  // Dr. Marcus Rivera: Sports Medicine / high-volume
  // -------------------------------------------------------------------------
  {
    patient: 'emma@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Injury Rehabilitation',
    daysOffset: -56,
    hour: 9,
    status: 'COMPLETED',
  },
  {
    patient: 'marcus.chen@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Performance Movement Screen',
    daysOffset: -50,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'marcus.chen@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Injury Rehabilitation',
    daysOffset: -47,
    hour: 11,
    status: 'COMPLETED',
    product: 'Electrolyte Performance Mix',
    isPartialRefund: true,
  },
  {
    patient: 'isabella@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Recovery & Regeneration Session',
    daysOffset: -44,
    hour: 9,
    status: 'COMPLETED',
    product: 'Sleep & Stress Support',
  },
  {
    patient: 'isabella@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Massage Therapy',
    daysOffset: -40,
    hour: 13,
    status: 'COMPLETED',
  },
  {
    patient: 'ryan@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Performance Movement Screen',
    daysOffset: -37,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'noah@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Injury Rehabilitation',
    daysOffset: -34,
    hour: 9,
    status: 'COMPLETED',
  },
  {
    patient: 'benjamin@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Recovery & Regeneration Session',
    daysOffset: -30,
    hour: 14,
    status: 'COMPLETED',
    isPartialPayment: true,
  },
  {
    patient: 'benjamin@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Massage Therapy',
    daysOffset: -27,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'olivia@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Functional Strength Assessment',
    daysOffset: -24,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'ava@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Injury Rehabilitation',
    daysOffset: -21,
    hour: 9,
    status: 'COMPLETED',
  },
  {
    patient: 'ethan@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Performance Movement Screen',
    daysOffset: -18,
    hour: 13,
    status: 'COMPLETED',
  },
  {
    patient: 'charlotte@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Massage Therapy',
    daysOffset: -14,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'lucas@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Recovery & Regeneration Session',
    daysOffset: -9,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'mia@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Functional Strength Assessment',
    daysOffset: -5,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'zoe@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Recovery & Regeneration Session',
    daysOffset: -3,
    hour: 9,
    status: 'COMPLETED',
    product: 'Magnesium Recovery Blend',
  },
  {
    patient: 'benjamin@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Recovery & Regeneration Session',
    daysOffset: -25,
    hour: 15,
    status: 'CANCELLED',
  },
  {
    patient: 'charlotte@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Massage Therapy',
    daysOffset: -17,
    hour: 10,
    status: 'CANCELLED',
  },
  // Upcoming (CONFIRMED)
  {
    patient: 'marcus.chen@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Sports Injury Rehabilitation',
    daysOffset: 5,
    hour: 9,
    status: 'CONFIRMED',
  },
  {
    patient: 'isabella@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Recovery & Regeneration Session',
    daysOffset: 9,
    hour: 14,
    status: 'CONFIRMED',
  },
  {
    patient: 'ryan@everwell.demo',
    provider: 'marcus@everwell.demo',
    service: 'Performance Movement Screen',
    daysOffset: 16,
    hour: 10,
    status: 'CONFIRMED',
  },

  // -------------------------------------------------------------------------
  // Dr. Priya Patel: Nutrition & Wellness / mid-tier
  // -------------------------------------------------------------------------
  {
    patient: 'emma@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Comprehensive Nutrition Consultation',
    daysOffset: -54,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'emma@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Follow-up Nutrition Session',
    daysOffset: -40,
    hour: 15,
    status: 'COMPLETED',
  },
  {
    patient: 'sophia@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Comprehensive Nutrition Consultation',
    daysOffset: -52,
    hour: 9,
    status: 'COMPLETED',
  },
  {
    patient: 'sophia@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Follow-up Nutrition Session',
    daysOffset: -36,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'isabella@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Sleep Optimization Consultation',
    daysOffset: -48,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'noah@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Comprehensive Nutrition Consultation',
    daysOffset: -33,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'ryan@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Follow-up Nutrition Session',
    daysOffset: -20,
    hour: 9,
    status: 'COMPLETED',
  },
  {
    patient: 'ava@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Sleep Optimization Consultation',
    daysOffset: -14,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'charlotte@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Comprehensive Nutrition Consultation',
    daysOffset: -8,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'benjamin@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Follow-up Nutrition Session',
    daysOffset: -3,
    hour: 10,
    status: 'COMPLETED',
  },
  {
    patient: 'lucas@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Comprehensive Nutrition Consultation',
    daysOffset: -28,
    hour: 9,
    status: 'NO_SHOW',
  },
  {
    patient: 'mia@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Follow-up Nutrition Session',
    daysOffset: -11,
    hour: 14,
    status: 'CANCELLED',
  },
  // Upcoming (CONFIRMED)
  {
    patient: 'emma@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Follow-up Nutrition Session',
    daysOffset: 6,
    hour: 15,
    status: 'CONFIRMED',
  },
  {
    patient: 'sophia@everwell.demo',
    provider: 'priya@everwell.demo',
    service: 'Sleep Optimization Consultation',
    daysOffset: 12,
    hour: 11,
    status: 'CONFIRMED',
  },

  // -------------------------------------------------------------------------
  // Coach James Wright: Mental Performance / lower utilization
  // -------------------------------------------------------------------------
  {
    patient: 'emma@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: -50,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'emma@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: -36,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'marcus.chen@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: -45,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'marcus.chen@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: -30,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'liam@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: -20,
    hour: 11,
    status: 'COMPLETED',
  },
  {
    patient: 'benjamin@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: -10,
    hour: 14,
    status: 'COMPLETED',
  },
  {
    patient: 'liam@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: -15,
    hour: 11,
    status: 'CANCELLED',
  },
  // Upcoming (CONFIRMED)
  {
    patient: 'emma@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: 8,
    hour: 11,
    status: 'CONFIRMED',
  },
  {
    patient: 'marcus.chen@everwell.demo',
    provider: 'james@everwell.demo',
    service: 'Mental Performance Coaching',
    daysOffset: 18,
    hour: 14,
    status: 'CONFIRMED',
  },
]

async function createClinicalHistory(params: {
  clinicId: string
  locationId: string
  users: Record<string, { id: string; name: string }>
  providers: Record<string, { id: string; firstName: string; lastName: string }>
  services: Record<string, { id: string; name: string; defaultPrice: unknown; duration: number }>
  products: Record<string, { id: string; price: unknown }>
  commissionRules: Record<string, { id: string; commissionValue: unknown }>
  frontDeskUserId: string
}) {
  const {
    clinicId,
    locationId,
    users,
    providers,
    services,
    products,
    commissionRules,
    frontDeskUserId,
  } = params

  const existing = await prisma.appointment.count({ where: { clinicId } })
  if (existing > 0) {
    console.log(`  ↩ Appointments already exist (${existing}): skipping clinical history`)
    return
  }

  let created = 0
  let invoicesCreated = 0
  let commissionRecordsCreated = 0

  for (const def of APPOINTMENT_DEFS) {
    const patientUser = users[def.patient]
    const providerUser = users[def.provider]
    const provider = providers[def.provider]
    const service = services[def.service]

    if (!patientUser || !providerUser || !provider || !service) {
      console.warn(
        `    ⚠ Skipping appointment: missing ref for ${def.patient}/${def.provider}/${def.service}`
      )
      continue
    }

    const startTime = daysFromNow(def.daysOffset, def.hour, 0)
    const endTime = addMinutes(startTime, service.duration)
    const servicePrice = Number(service.defaultPrice)

    const appointment = await prisma.appointment.create({
      data: {
        clinicId,
        locationId,
        providerId: provider.id,
        serviceId: service.id,
        patientId: patientUser.id,
        startTime,
        endTime,
        status: def.status as AppointmentStatus,
        priceAtBooking: servicePrice,
        paymentStatus:
          def.status === 'COMPLETED' && !def.isOutstanding
            ? PaymentStatus.PAID
            : def.status === 'COMPLETED' && def.isPartialPayment
              ? PaymentStatus.PARTIALLY_REFUNDED
              : PaymentStatus.NONE,
        paymentRequirementType: 'NONE',
        approvalStatus: 'NOT_REQUIRED',
        bookingSource: 'FRONT_DESK',
        cancelledAt: def.status === 'CANCELLED' ? startTime : undefined,
        notes:
          def.status === 'NO_SHOW'
            ? 'Patient did not attend: no advance notice received.'
            : undefined,
        timezone: 'America/Los_Angeles',
      },
    })
    created++

    // -------------------------------------------------------------------
    // Invoice + Payment + Commission Records (COMPLETED only)
    // -------------------------------------------------------------------
    if (def.status === 'COMPLETED') {
      const productEntry = def.product ? products[def.product] : null
      const productPrice = productEntry ? Number(productEntry.price) : 0

      const subtotal = decimal(servicePrice + productPrice)
      const totalAmount = subtotal // no tax in demo

      // Determine invoice status
      let invoiceStatus: InvoiceStatus
      if (def.isOutstanding) {
        invoiceStatus = InvoiceStatus.FINALIZED
      } else if (def.isFullRefund) {
        invoiceStatus = InvoiceStatus.CANCELLED
      } else {
        invoiceStatus = InvoiceStatus.PAID
      }

      const invoice = await prisma.invoice.create({
        data: {
          clinicId,
          appointmentId: appointment.id,
          patientId: patientUser.id,
          providerId: provider.id,
          status: invoiceStatus,
          subtotal,
          taxAmount: 0,
          totalAmount,
        },
      })

      // Service invoice item
      const serviceItem = await prisma.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          serviceId: service.id,
          providerId: provider.id,
          description: service.name,
          unitPrice: servicePrice,
          quantity: 1,
          totalPrice: servicePrice,
        },
      })

      // Optional product invoice item
      let productItem: { id: string; totalPrice: unknown } | null = null
      if (productEntry && def.product) {
        productItem = await prisma.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: productEntry.id,
            description: def.product,
            unitPrice: productPrice,
            quantity: 1,
            totalPrice: productPrice,
          },
        })
      }

      invoicesCreated++

      // Determine payment amount and refund state
      if (!def.isOutstanding) {
        const now = daysFromNow(def.daysOffset, def.hour + 1, 0) // just after appt

        if (def.isFullRefund) {
          // Full payment first
          const origPayment = await prisma.payment.create({
            data: {
              clinicId,
              invoiceId: invoice.id,
              appointmentId: appointment.id,
              patientId: patientUser.id,
              providerId: provider.id,
              amount: totalAmount,
              status: PaymentStatus.PAID,
              paymentChannel: 'MANUAL',
              paymentMethod: 'CASH',
              recordedById: frontDeskUserId,
              recordedAt: now,
            },
          })
          // Full refund
          await prisma.payment.create({
            data: {
              clinicId,
              invoiceId: invoice.id,
              patientId: patientUser.id,
              refundForPaymentId: origPayment.id,
              amount: totalAmount,
              status: PaymentStatus.REFUNDED,
              paymentChannel: 'MANUAL',
              paymentMethod: 'CASH',
              recordedById: frontDeskUserId,
              recordedAt: daysFromNow(def.daysOffset + 3, 10, 0),
              notes: 'Full refund: patient unable to attend follow-up program.',
            },
          })
          // No commission on refunded invoice
        } else if (def.isPartialRefund) {
          const refundAmt = decimal(servicePrice * 0.5)
          const origPayment = await prisma.payment.create({
            data: {
              clinicId,
              invoiceId: invoice.id,
              appointmentId: appointment.id,
              patientId: patientUser.id,
              providerId: provider.id,
              amount: totalAmount,
              status: PaymentStatus.PAID,
              paymentChannel: 'MANUAL',
              paymentMethod: 'BANK_TRANSFER',
              recordedById: frontDeskUserId,
              recordedAt: now,
            },
          })
          await prisma.payment.create({
            data: {
              clinicId,
              invoiceId: invoice.id,
              patientId: patientUser.id,
              refundForPaymentId: origPayment.id,
              amount: refundAmt,
              status: PaymentStatus.REFUNDED,
              paymentChannel: 'MANUAL',
              paymentMethod: 'BANK_TRANSFER',
              recordedById: frontDeskUserId,
              recordedAt: daysFromNow(def.daysOffset + 5, 10, 0),
              notes: 'Partial refund: service partially completed.',
            },
          })
          // Commission on partially refunded: skip (conservative)
        } else if (def.isPartialPayment) {
          const paidAmt = decimal(totalAmount * 0.55)
          await prisma.payment.create({
            data: {
              clinicId,
              invoiceId: invoice.id,
              appointmentId: appointment.id,
              patientId: patientUser.id,
              providerId: provider.id,
              amount: paidAmt,
              status: PaymentStatus.PAID,
              paymentChannel: 'MANUAL',
              paymentMethod: 'CASH',
              recordedById: frontDeskUserId,
              recordedAt: now,
              notes: 'Partial payment: balance to be collected at next appointment.',
            },
          })
          // No commission on partially paid invoice
        } else {
          // Standard full payment
          const method = totalAmount > 120 ? 'BANK_TRANSFER' : 'CASH'
          await prisma.payment.create({
            data: {
              clinicId,
              invoiceId: invoice.id,
              appointmentId: appointment.id,
              patientId: patientUser.id,
              providerId: provider.id,
              amount: totalAmount,
              status: PaymentStatus.PAID,
              paymentChannel: 'MANUAL',
              paymentMethod: method,
              recordedById: frontDeskUserId,
              recordedAt: now,
            },
          })

          // Commission records (all PENDING, except some older ones PAID)
          const rule = commissionRules[def.provider]
          if (rule) {
            const rate = Number(rule.commissionValue) / 100
            const earnedAt = now
            const isOld = def.daysOffset < -30 // older invoices are already marked paid
            const commStatus = isOld ? CommissionStatus.PAID : CommissionStatus.PENDING

            const items: { id: string; totalPrice: unknown }[] = [serviceItem]
            if (productItem) items.push(productItem)

            for (const item of items) {
              const basis = Number(item.totalPrice)
              const commAmt = decimal(basis * rate)
              await prisma.commissionRecord.create({
                data: {
                  clinicId,
                  providerId: provider.id,
                  invoiceId: invoice.id,
                  invoiceItemId: item.id,
                  ruleId: rule.id,
                  basisAmount: basis,
                  amount: commAmt,
                  status: commStatus,
                  earnedAt,
                  paidOutAt: isOld ? daysFromNow(def.daysOffset + 14, 9, 0) : undefined,
                },
              })
              commissionRecordsCreated++
            }
          }
        }
      }

      // -------------------------------------------------------------------
      // Visit Records + AI Scribe
      // -------------------------------------------------------------------
      if (def.isHeroFinalVisit) {
        await createHeroFinalVisit(
          clinicId,
          appointment.id,
          provider.id,
          patientUser.id,
          frontDeskUserId
        )
      }
    } // end COMPLETED block

    if (def.isHeroDraftVisit && def.status === 'CONFIRMED') {
      await createHeroDraftVisit(clinicId, appointment.id, provider.id, patientUser.id)
    }
  }

  console.log(`  ✓ Appointments: ${created} created`)
  console.log(`  ✓ Invoices: ${invoicesCreated} created`)
  console.log(`  ✓ Commission records: ${commissionRecordsCreated} created`)
}

// Hero: completed appointment with FINAL visit record, APPROVED AI scribe, published summary
async function createHeroFinalVisit(
  clinicId: string,
  appointmentId: string,
  providerId: string,
  patientId: string,
  createdById: string
) {
  const existing = await prisma.visitRecord.findFirst({ where: { appointmentId } })
  if (existing) return

  const visitRecord = await prisma.visitRecord.create({
    data: {
      clinicId,
      appointmentId,
      providerId,
      patientId,
      subjective:
        'Patient reports persistent lower back discomfort that began 6 weeks ago following increased running mileage. Pain rated 4/10 at rest, 7/10 with prolonged sitting or forward flexion. No radiation to lower extremities. Previous episode 2 years ago resolved with rest.',
      objective:
        'ROM: lumbar flexion 65° (limited), extension 20°, lateral flexion L 30° / R 28°. Mild tenderness at L4-L5 paraspinals bilaterally. SLR negative. Hip flexor tightness grade 2/4 bilaterally. Posture: anterior pelvic tilt, mild forward head position.',
      assessment:
        'Mechanical lower back pain secondary to hip flexor tightness and core inhibition pattern, exacerbated by training load increase. No neurological involvement. Functional deficits in lumbar stability and posterior chain activation.',
      plan: '6-session physiotherapy program: sessions 1-3 focused on manual therapy and hip flexor release; sessions 4-6 progressive lumbar stabilisation and return-to-running load management. Home program: 3x daily hip flexor stretches, glute activation, pelvic tilts. Reassess at session 3. Running on hold for 2 weeks.',
      status: 'FINAL',
      isFinalized: true,
    },
  })

  // Create a VisitNoteVersion for the version history
  const version = await prisma.visitNoteVersion.create({
    data: {
      visitRecordId: visitRecord.id,
      subjective: visitRecord.subjective ?? '',
      objective: visitRecord.objective ?? '',
      assessment: visitRecord.assessment ?? '',
      plan: visitRecord.plan ?? '',
      createdById,
    },
  })

  // Link the current version
  await prisma.visitRecord.update({
    where: { id: visitRecord.id },
    data: { currentVersionId: version.id },
  })

  // AI Scribe session: APPROVED, summary published
  const aiExisting = await prisma.aIScribeSession.findFirst({
    where: { visitRecordId: visitRecord.id },
  })
  if (!aiExisting) {
    await prisma.aIScribeSession.create({
      data: {
        visitRecordId: visitRecord.id,
        providerId,
        clinicId,
        status: AIScribeStatus.APPROVED,
        patientSummaryPublished: true,
        aiModel: 'gpt-4o-mini',
        aiDraft: {
          subjective:
            'Patient reports persistent lower back discomfort that began 6 weeks ago following increased running mileage. Pain rated 4/10 at rest, 7/10 with prolonged sitting or forward flexion.',
          objective:
            'ROM: lumbar flexion 65°. Mild tenderness at L4-L5 paraspinals. SLR negative. Hip flexor tightness grade 2/4.',
          assessment:
            'Mechanical lower back pain secondary to hip flexor tightness and core inhibition pattern. No neurological involvement.',
          plan: '6-session physiotherapy program targeting hip flexor release and lumbar stabilisation. Running on hold for 2 weeks. Reassess at session 3.',
        },
        patientSummary: {
          summary:
            'Your physiotherapy assessment is complete. You have mechanical lower back pain related to tight hip flexors and reduced core stability, a very common pattern in runners. There is no nerve involvement, which is great news.',
          keyFindings: [
            'Lower back stiffness primarily from hip flexor tightness',
            'Core stability will be progressively rebuilt through your program',
            'No nerve-related symptoms detected',
          ],
          recommendations: [
            'Perform your hip flexor stretches and pelvic tilts 3 times daily as demonstrated',
            'Avoid running for the next 2 weeks to allow tissue recovery',
            'Your next 5 sessions are scheduled; consistency is important for the best outcome',
          ],
          followUpNote:
            'Dr. Chen will reassess your progress at session 3. Bring any questions you have to your next appointment.',
        },
        processingStartedAt: new Date(),
        processingCompletedAt: new Date(),
      },
    })
  }
}

// Hero: upcoming appointment with DRAFT visit record + DRAFT_GENERATED AI scribe
async function createHeroDraftVisit(
  clinicId: string,
  appointmentId: string,
  providerId: string,
  patientId: string
) {
  const existing = await prisma.visitRecord.findFirst({ where: { appointmentId } })
  if (existing) return

  const visitRecord = await prisma.visitRecord.create({
    data: {
      clinicId,
      appointmentId,
      providerId,
      patientId,
      status: 'DRAFT',
      isFinalized: false,
    },
  })

  const aiExisting = await prisma.aIScribeSession.findFirst({
    where: { visitRecordId: visitRecord.id },
  })
  if (!aiExisting) {
    await prisma.aIScribeSession.create({
      data: {
        visitRecordId: visitRecord.id,
        providerId,
        clinicId,
        status: AIScribeStatus.DRAFT_GENERATED,
        patientSummaryPublished: false,
        aiModel: 'gpt-4o-mini',
        aiDraft: {
          subjective:
            'Patient returns for follow-up. Reports significant improvement in resting pain, now 1/10. Sitting tolerance improved to 45 minutes. Completed home program consistently. Running resumed at low intensity (3 km) with no pain during activity, mild stiffness the following morning.',
          objective:
            'ROM: lumbar flexion 78° (improved from 65°), extension 25°. Paraspinal tenderness resolved. Hip flexor flexibility improved bilaterally. Single-leg squat: controlled, mild trunk deviation on left. Core activation: improving, still some inhibition in transversus abdominis.',
          assessment:
            'Excellent response to physiotherapy. Mechanical lower back pain resolving. Residual core stability deficit and mild left hip control impairment, appropriate at this stage of rehabilitation.',
          plan: 'Continue sessions 4-6 with progressive loading: introduce single-leg deadlifts, lateral band walks, running return protocol (build by 10% per week). Home program: add bird-dog 3 sets × 10 reps daily. Clear to increase running to 5 km if symptom-free.',
        },
        processingStartedAt: new Date(),
        processingCompletedAt: new Date(),
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Phase 9: Patient Packages & Subscriptions
// ---------------------------------------------------------------------------

async function createEntitlements(params: {
  clinicId: string
  users: Record<string, { id: string }>
  packages: Record<string, { id: string; totalSessions: number | null }>
  memberships: Record<string, { id: string }>
}) {
  const { clinicId, users, packages, memberships } = params

  // Patient Packages
  const packageDefs = [
    {
      patientEmail: 'emma@everwell.demo',
      packageName: '3-Session Recovery Package',
      totalSessions: 3,
      usedSessions: 1,
      status: PackageStatus.ACTIVE,
      expiresOffset: 89,
    },
    {
      patientEmail: 'marcus.chen@everwell.demo',
      packageName: '6-Session Performance Package',
      totalSessions: 6,
      usedSessions: 4,
      status: PackageStatus.ACTIVE,
      expiresOffset: 120,
    },
    {
      patientEmail: 'ethan@everwell.demo',
      packageName: '10-Session Physio Rehab Package',
      totalSessions: 10,
      usedSessions: 10,
      status: PackageStatus.EXHAUSTED,
      expiresOffset: 30,
    },
  ]

  for (const pd of packageDefs) {
    const patient = users[pd.patientEmail]
    const pkg = packages[pd.packageName]
    if (!patient || !pkg) continue
    const existing = await prisma.patientPackage.findFirst({
      where: { patientId: patient.id, packageId: pkg.id, clinicId },
    })
    if (!existing) {
      await prisma.patientPackage.create({
        data: {
          clinicId,
          patientId: patient.id,
          packageId: pkg.id,
          status: pd.status,
          totalSessions: pd.totalSessions,
          usedSessions: pd.usedSessions,
          expiresAt: daysFromNow(pd.expiresOffset),
        },
      })
    }
  }
  console.log(`  ✓ Patient packages: ${packageDefs.length} created/found`)

  // Patient Subscriptions
  const subscriptionDefs = [
    {
      patientEmail: 'emma@everwell.demo',
      membershipName: 'Monthly Wellness Membership',
      status: SubscriptionStatus.ACTIVE,
      periodStart: daysFromNow(-30),
      periodEnd: daysFromNow(0),
    },
    {
      patientEmail: 'isabella@everwell.demo',
      membershipName: 'Premium Longevity Membership',
      status: SubscriptionStatus.ACTIVE,
      periodStart: daysFromNow(-30),
      periodEnd: daysFromNow(0),
    },
  ]

  for (const sd of subscriptionDefs) {
    const patient = users[sd.patientEmail]
    const membership = memberships[sd.membershipName]
    if (!patient || !membership) continue
    const existing = await prisma.patientSubscription.findFirst({
      where: { patientId: patient.id, membershipId: membership.id, clinicId },
    })
    if (!existing) {
      await prisma.patientSubscription.create({
        data: {
          clinicId,
          patientId: patient.id,
          membershipId: membership.id,
          status: sd.status,
          currentPeriodStart: sd.periodStart,
          currentPeriodEnd: sd.periodEnd,
          cancelAtPeriodEnd: false,
        },
      })
    }
  }
  console.log(`  ✓ Patient subscriptions: ${subscriptionDefs.length} created/found`)
}

// ---------------------------------------------------------------------------
// Phase 10: Standalone Commerce Invoices (packages + memberships)
// ---------------------------------------------------------------------------

async function createStandaloneCommerceInvoices(params: {
  clinicId: string
  users: Record<string, { id: string }>
  packages: Record<string, { id: string; price: unknown }>
  memberships: Record<string, { id: string; monthlyPrice: unknown }>
  providers: Record<string, { id: string }>
  frontDeskUserId: string
}) {
  const { clinicId, users, packages, memberships, providers, frontDeskUserId } = params
  const defaultProviderId = Object.values(providers)[0]?.id
  if (!defaultProviderId) {
    console.warn('  ⚠ No providers found for standalone invoices')
  }

  const existing = await prisma.invoice.count({
    where: { clinicId, appointmentId: null },
  })
  if (existing > 0) {
    console.log(`  ↩ Standalone invoices already exist (${existing}): skipping`)
    return
  }

  // Package purchase invoices
  const packagePurchases = [
    { patientEmail: 'emma@everwell.demo', packageName: '3-Session Recovery Package', daysAgo: 90 },
    {
      patientEmail: 'marcus.chen@everwell.demo',
      packageName: '6-Session Performance Package',
      daysAgo: 55,
    },
    {
      patientEmail: 'ethan@everwell.demo',
      packageName: '10-Session Physio Rehab Package',
      daysAgo: 120,
    },
  ]

  for (const pp of packagePurchases) {
    const patient = users[pp.patientEmail]
    const pkg = packages[pp.packageName]
    if (!patient || !pkg) continue
    const price = Number(pkg.price)
    const invoice = await prisma.invoice.create({
      data: {
        clinicId,
        patientId: patient.id,
        providerId: defaultProviderId,
        status: InvoiceStatus.PAID,
        subtotal: price,
        taxAmount: 0,
        totalAmount: price,
        createdAt: daysFromNow(-pp.daysAgo),
      },
    })
    await prisma.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        packageId: pkg.id,
        description: pp.packageName,
        unitPrice: price,
        quantity: 1,
        totalPrice: price,
      },
    })
    await prisma.payment.create({
      data: {
        clinicId,
        invoiceId: invoice.id,
        patientId: patient.id,
        amount: price,
        status: PaymentStatus.PAID,
        paymentChannel: 'MANUAL',
        paymentMethod: 'CASH',
        recordedById: frontDeskUserId,
        recordedAt: daysFromNow(-pp.daysAgo),
      },
    })
  }

  // Membership purchase invoices
  const membershipPurchases = [
    {
      patientEmail: 'emma@everwell.demo',
      membershipName: 'Monthly Wellness Membership',
      daysAgo: 30,
    },
    {
      patientEmail: 'isabella@everwell.demo',
      membershipName: 'Premium Longevity Membership',
      daysAgo: 30,
    },
  ]

  for (const mp of membershipPurchases) {
    const patient = users[mp.patientEmail]
    const membership = memberships[mp.membershipName]
    if (!patient || !membership) continue
    const price = Number(membership.monthlyPrice)
    const invoice = await prisma.invoice.create({
      data: {
        clinicId,
        patientId: patient.id,
        providerId: defaultProviderId,
        status: InvoiceStatus.PAID,
        subtotal: price,
        taxAmount: 0,
        totalAmount: price,
        createdAt: daysFromNow(-mp.daysAgo),
      },
    })
    await prisma.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        membershipId: membership.id,
        description: mp.membershipName,
        unitPrice: price,
        quantity: 1,
        totalPrice: price,
      },
    })
    await prisma.payment.create({
      data: {
        clinicId,
        invoiceId: invoice.id,
        patientId: patient.id,
        amount: price,
        status: PaymentStatus.PAID,
        paymentChannel: 'MANUAL',
        paymentMethod: 'CASH',
        recordedById: frontDeskUserId,
        recordedAt: daysFromNow(-mp.daysAgo),
      },
    })
  }

  console.log(`  ✓ Standalone commerce invoices created`)
}

// ---------------------------------------------------------------------------
// Phase 11: Prebuilt Carts
// ---------------------------------------------------------------------------

async function createPrebuiltCarts(params: {
  clinicId: string
  users: Record<string, { id: string }>
  products: Record<string, { id: string; price: unknown }>
}) {
  const { clinicId, users, products } = params

  const emma = users['emma@everwell.demo']
  if (!emma) return

  const existing = await prisma.cart.findFirst({
    where: { patientId: emma.id, clinicId, status: 'ACTIVE' },
  })
  if (existing) {
    console.log('  ↩ Prebuilt cart for Emma already exists, skipping')
    return
  }

  const cart = await prisma.cart.create({
    data: { clinicId, patientId: emma.id, status: 'ACTIVE' },
  })

  const cartItems = [
    { name: 'Daily Wellness Pack', qty: 1 },
    { name: 'Mobility Roller Kit', qty: 1 },
  ]

  for (const item of cartItems) {
    const product = products[item.name]
    if (product) {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          itemType: 'PRODUCT',
          quantity: item.qty,
          unitPrice: Number(product.price),
        },
      })
    }
  }
  console.log('  ✓ Prebuilt cart created for Emma Hartwell')
}

// ---------------------------------------------------------------------------
// Phase 12: Completed Commerce Orders (Storefront style)
// ---------------------------------------------------------------------------

async function createCompletedCommerceOrders(params: {
  clinicId: string
  users: Record<string, { id: string }>
  products: Record<string, { id: string; price: unknown }>
  providers: Record<string, { id: string }>
  frontDeskUserId: string
}) {
  const { clinicId, users, products, providers, frontDeskUserId } = params

  const ryan = users['ryan@everwell.demo']
  if (!ryan) return

  const existing = await prisma.invoice.findFirst({
    where: { patientId: ryan.id, clinicId, appointmentId: null },
  })
  if (existing) {
    console.log('  ↩ Completed commerce order for Ryan already exists, skipping')
    return
  }

  const product = products['Mobility Roller Kit']
  const provider = Object.values(providers)[0]
  if (!product || !provider) return

  const price = Number(product.price)

  const invoice = await prisma.invoice.create({
    data: {
      clinicId,
      patientId: ryan.id,
      providerId: provider.id,
      status: InvoiceStatus.PAID,
      subtotal: price,
      taxAmount: 0,
      totalAmount: price,
      createdAt: daysFromNow(-2),
    },
  })

  await prisma.invoiceItem.create({
    data: {
      invoiceId: invoice.id,
      productId: product.id,
      description: 'Mobility Roller Kit (Storefront Purchase)',
      unitPrice: price,
      quantity: 1,
      totalPrice: price,
    },
  })

  await prisma.payment.create({
    data: {
      clinicId,
      invoiceId: invoice.id,
      patientId: ryan.id,
      amount: price,
      status: PaymentStatus.PAID,
      paymentChannel: 'MANUAL',
      paymentMethod: 'CASH',
      recordedById: frontDeskUserId,
      recordedAt: daysFromNow(-2),
    },
  })

  // Inventory reduction
  await prisma.inventoryItem.update({
    where: { productId: product.id },
    data: { quantityInStock: { decrement: 1 } },
  })

  console.log('  ✓ Completed commerce order created for Ryan Thompson')
}

// ---------------------------------------------------------------------------
// Phase 13: AI Front Desk (voice agent): config + a realistic call log
// ---------------------------------------------------------------------------

type SeedTranscriptTurn = { role: 'assistant' | 'user'; content: string; offsetSec: number }
type SeedCallEvent = {
  type: 'tool_call' | 'transfer' | 'error' | 'interrupt'
  toolName?: string
  argsJson?: Prisma.InputJsonValue
  resultJson?: Prisma.InputJsonValue
  errorMessage?: string
  offsetSec: number
}
type SeedVoiceCall = {
  channel: VoiceCallChannel
  status: VoiceCallStatus
  outcome: VoiceCallOutcome | null
  callerName: string
  callerPhone: string | null
  patientEmail?: string
  daysAgo: number
  hour: number
  minute: number
  durationSec: number
  summary: string | null
  transcript: SeedTranscriptTurn[]
  events: SeedCallEvent[]
}

async function createVoiceAgentData(params: {
  clinicId: string
  users: Record<string, { id: string; name: string }>
}) {
  const { clinicId, users } = params
  const patientId = (email: string): string | null => users[email]?.id ?? null

  // Config: idempotent via the unique clinicId. Enabled, warm persona, with
  // business hours and a clinic-specific instruction block so the admin UI
  // (/dashboard/voice-agent → Configure) shows a fully populated example.
  await prisma.voiceAgentConfig.upsert({
    where: { clinicId },
    update: {},
    create: {
      clinicId,
      enabled: true,
      persona: VoicePersona.WARM,
      voice: 'hannah', // Groq Orpheus WARM voice (see ttsService persona mapping)
      greeting:
        "Thanks for calling Everwell! This is Ava, the clinic's virtual assistant. " +
        'I can help you book or change an appointment, request a refill, or answer ' +
        'questions about our services. How can I help you today?',
      businessHours: {
        mon: { open: '09:00', close: '17:00' },
        tue: { open: '09:00', close: '17:00' },
        wed: { open: '09:00', close: '17:00' },
        thu: { open: '09:00', close: '17:00' },
        fri: { open: '09:00', close: '17:00' },
        sat: { open: '10:00', close: '14:00' },
        sun: null,
      },
      afterHoursMessage:
        "We're closed right now, but I can take a message and someone will call you " +
        'back on the next business day, or I can help you book online. Which would you prefer?',
      escalationPhone: '+1 (555) 010-2000',
      capabilities: {
        book: true,
        reschedule: true,
        cancel: true,
        refill: true,
        messages: true,
        transfer: true,
        info: true,
      },
      systemPromptExtra:
        'Everwell is a multi-disciplinary clinic: physiotherapy, sports medicine, ' +
        'nutrition & wellness, and mental performance. Offer new patients a complimentary ' +
        '15-minute phone consult before their first visit. Dr. Sarah Chen leads physiotherapy; ' +
        'Coach James Wright handles mental performance. Never give clinical advice; book a ' +
        'visit or take a message instead.',
    },
  })

  // Call log: skip if this clinic already has calls (matches the appointment guard).
  const existingCalls = await prisma.voiceCall.count({ where: { clinicId } })
  if (existingCalls > 0) {
    console.log(`  ↩ Voice calls already exist (${existingCalls}): config ensured, calls skipped`)
    return
  }

  // Eight calls, one per outcome, so the call log demonstrates the full range.
  const calls: SeedVoiceCall[] = [
    {
      channel: VoiceCallChannel.BROWSER,
      status: VoiceCallStatus.COMPLETED,
      outcome: VoiceCallOutcome.APPOINTMENT_BOOKED,
      callerName: 'Emma Hartwell',
      callerPhone: '+1 (555) 014-2201',
      patientEmail: 'emma@everwell.demo',
      daysAgo: 8,
      hour: 9,
      minute: 42,
      durationSec: 88,
      summary:
        'Emma Hartwell booked an Initial Physiotherapy Assessment with Dr. Sarah Chen for Thursday at 9:30 AM. Confirmation emailed.',
      transcript: [
        {
          role: 'assistant',
          content: 'Thanks for calling Everwell! This is Ava. How can I help you today?',
          offsetSec: 0,
        },
        { role: 'user', content: "Hi, I'd like to book a physio assessment.", offsetSec: 6 },
        {
          role: 'assistant',
          content: 'Happy to help. Can I get your name so I can pull up your file?',
          offsetSec: 11,
        },
        { role: 'user', content: 'Emma Hartwell.', offsetSec: 16 },
        {
          role: 'assistant',
          content:
            'Thanks, Emma, found you. Dr. Sarah Chen has openings for an Initial Physiotherapy Assessment. What day works?',
          offsetSec: 22,
        },
        { role: 'user', content: 'Something Thursday morning?', offsetSec: 33 },
        {
          role: 'assistant',
          content: 'Dr. Chen has 9:30 or 11:00 on Thursday. Which would you like?',
          offsetSec: 39,
        },
        { role: 'user', content: '9:30, please.', offsetSec: 48 },
        {
          role: 'assistant',
          content:
            "Done: you're booked with Dr. Sarah Chen Thursday at 9:30 for a 60-minute assessment. A confirmation is on its way to your email. Anything else?",
          offsetSec: 54,
        },
        { role: 'user', content: "No, that's everything. Thank you!", offsetSec: 72 },
        { role: 'assistant', content: 'Have a great day, Emma!', offsetSec: 78 },
      ],
      events: [
        {
          type: 'tool_call',
          toolName: 'lookup_patient',
          argsJson: { name: 'Emma Hartwell' },
          resultJson: { found: true, patient: 'emma@everwell.demo' },
          offsetSec: 18,
        },
        {
          type: 'tool_call',
          toolName: 'check_availability',
          argsJson: {
            provider: 'Dr. Sarah Chen',
            service: 'Initial Physiotherapy Assessment',
            day: 'Thursday',
          },
          resultJson: { slots: ['09:30', '11:00'] },
          offsetSec: 25,
        },
        {
          type: 'tool_call',
          toolName: 'book_appointment',
          argsJson: {
            provider: 'Dr. Sarah Chen',
            service: 'Initial Physiotherapy Assessment',
            start: 'Thursday 09:30',
          },
          resultJson: { booked: true },
          offsetSec: 52,
        },
      ],
    },
    {
      channel: VoiceCallChannel.PHONE,
      status: VoiceCallStatus.COMPLETED,
      outcome: VoiceCallOutcome.APPOINTMENT_RESCHEDULED,
      callerName: 'Liam Nakamura',
      callerPhone: '+1 (555) 013-8870',
      patientEmail: 'liam@everwell.demo',
      daysAgo: 6,
      hour: 14,
      minute: 5,
      durationSec: 74,
      summary:
        'Liam Nakamura moved his Follow-up Physiotherapy Session from Tuesday 3:00 PM to Friday 10:30 AM with Dr. Sarah Chen.',
      transcript: [
        {
          role: 'assistant',
          content: 'Thanks for calling Everwell, this is Ava. How can I help?',
          offsetSec: 0,
        },
        { role: 'user', content: 'I need to move my appointment this week.', offsetSec: 5 },
        { role: 'assistant', content: 'Sure: can I get your name?', offsetSec: 10 },
        { role: 'user', content: 'Liam Nakamura.', offsetSec: 14 },
        {
          role: 'assistant',
          content:
            'Thanks, Liam. I see a Follow-up Physiotherapy Session Tuesday at 3:00 PM with Dr. Chen. When would you like to move it to?',
          offsetSec: 20,
        },
        { role: 'user', content: 'Is Friday morning possible?', offsetSec: 31 },
        {
          role: 'assistant',
          content: 'Dr. Chen has 10:30 AM on Friday. Shall I move it there?',
          offsetSec: 37,
        },
        { role: 'user', content: 'Perfect, yes.', offsetSec: 45 },
        {
          role: 'assistant',
          content:
            "All set: moved to Friday 10:30 AM. You'll get an updated confirmation. Anything else?",
          offsetSec: 50,
        },
        { role: 'user', content: "That's it, thanks!", offsetSec: 64 },
      ],
      events: [
        {
          type: 'tool_call',
          toolName: 'lookup_patient',
          argsJson: { name: 'Liam Nakamura' },
          resultJson: { found: true, patient: 'liam@everwell.demo' },
          offsetSec: 16,
        },
        {
          type: 'tool_call',
          toolName: 'check_availability',
          argsJson: { provider: 'Dr. Sarah Chen', day: 'Friday' },
          resultJson: { slots: ['10:30', '13:00'] },
          offsetSec: 33,
        },
        {
          type: 'tool_call',
          toolName: 'book_appointment',
          argsJson: { action: 'reschedule', to: 'Friday 10:30' },
          resultJson: { rescheduled: true },
          offsetSec: 47,
        },
      ],
    },
    {
      channel: VoiceCallChannel.BROWSER,
      status: VoiceCallStatus.COMPLETED,
      outcome: VoiceCallOutcome.APPOINTMENT_CANCELLED,
      callerName: 'Sophia Martinez',
      callerPhone: '+1 (555) 017-5532',
      patientEmail: 'sophia@everwell.demo',
      daysAgo: 5,
      hour: 11,
      minute: 20,
      durationSec: 61,
      summary:
        'Sophia Martinez cancelled her Comprehensive Nutrition Consultation (Wednesday 2:00 PM). Within the free-cancellation window; no fee applied.',
      transcript: [
        { role: 'assistant', content: 'Everwell, this is Ava. How can I help?', offsetSec: 0 },
        {
          role: 'user',
          content: 'I have to cancel my nutrition appointment, something came up.',
          offsetSec: 5,
        },
        { role: 'assistant', content: 'No problem. Your name?', offsetSec: 12 },
        { role: 'user', content: 'Sophia Martinez.', offsetSec: 16 },
        {
          role: 'assistant',
          content:
            "Thanks, Sophia. That's the Comprehensive Nutrition Consultation Wednesday at 2:00 PM. You're outside 24 hours, so there's no cancellation fee. Shall I cancel it?",
          offsetSec: 22,
        },
        { role: 'user', content: 'Yes please. Can I rebook later?', offsetSec: 38 },
        {
          role: 'assistant',
          content:
            "Absolutely: call back any time and I'll find you a new slot. Your appointment is now cancelled. Anything else?",
          offsetSec: 44,
        },
        { role: 'user', content: 'No, thank you.', offsetSec: 56 },
      ],
      events: [
        {
          type: 'tool_call',
          toolName: 'lookup_patient',
          argsJson: { name: 'Sophia Martinez' },
          resultJson: { found: true, patient: 'sophia@everwell.demo' },
          offsetSec: 18,
        },
        {
          type: 'tool_call',
          toolName: 'book_appointment',
          argsJson: {
            action: 'cancel',
            appointment: 'Comprehensive Nutrition Consultation, Wed 14:00',
          },
          resultJson: { cancelled: true, fee: 0 },
          offsetSec: 42,
        },
      ],
    },
    {
      channel: VoiceCallChannel.PHONE,
      status: VoiceCallStatus.COMPLETED,
      outcome: VoiceCallOutcome.REFILL_REQUESTED,
      callerName: 'Olivia Park',
      callerPhone: '+1 (555) 012-6690',
      patientEmail: 'olivia@everwell.demo',
      daysAgo: 4,
      hour: 16,
      minute: 48,
      durationSec: 69,
      summary:
        'Olivia Park requested a refill of her anti-inflammatory prescription. Logged for Dr. Marcus Rivera to review and approve; patient told to expect a text once sent to the pharmacy.',
      transcript: [
        {
          role: 'assistant',
          content: 'Thanks for calling Everwell, this is Ava. How can I help?',
          offsetSec: 0,
        },
        {
          role: 'user',
          content: "I'm out of my anti-inflammatory and need a refill.",
          offsetSec: 5,
        },
        {
          role: 'assistant',
          content: 'I can get that started. Can I confirm your name and date of birth?',
          offsetSec: 12,
        },
        { role: 'user', content: 'Olivia Park, March 3rd 1990.', offsetSec: 19 },
        {
          role: 'assistant',
          content:
            "Thanks, Olivia. I've logged a refill request for your anti-inflammatory. Dr. Rivera reviews these and, once approved, it's sent to your pharmacy on file. You'll get a text when it's ready. Anything else?",
          offsetSec: 27,
        },
        { role: 'user', content: "That's great, thanks.", offsetSec: 58 },
      ],
      events: [
        {
          type: 'tool_call',
          toolName: 'lookup_patient',
          argsJson: { name: 'Olivia Park', dob: '1990-03-03' },
          resultJson: { found: true, patient: 'olivia@everwell.demo' },
          offsetSec: 22,
        },
        {
          type: 'tool_call',
          toolName: 'request_refill',
          argsJson: { medication: 'anti-inflammatory', reviewer: 'Dr. Marcus Rivera' },
          resultJson: { logged: true, status: 'pending_provider_approval' },
          offsetSec: 40,
        },
      ],
    },
    {
      channel: VoiceCallChannel.PHONE,
      status: VoiceCallStatus.COMPLETED,
      outcome: VoiceCallOutcome.MESSAGE_TAKEN,
      callerName: 'Daniel Okafor',
      callerPhone: '+1 (555) 019-3312',
      daysAgo: 3,
      hour: 19,
      minute: 35,
      durationSec: 52,
      summary:
        'After-hours call. Prospective patient Daniel Okafor asked whether the clinic treats runners with recurring knee pain. Message taken for the front desk to call back next business day.',
      transcript: [
        {
          role: 'assistant',
          content:
            "Thanks for calling Everwell. We're closed right now, but I can take a message or help you book. What do you need?",
          offsetSec: 0,
        },
        {
          role: 'user',
          content: "I'm a runner with ongoing knee pain. Do you treat that?",
          offsetSec: 8,
        },
        {
          role: 'assistant',
          content:
            "We do: that's a great fit for our sports medicine and physiotherapy teams. Since we're closed, can I take your name and number for a callback?",
          offsetSec: 15,
        },
        { role: 'user', content: 'Daniel Okafor, 555-019-3312.', offsetSec: 27 },
        {
          role: 'assistant',
          content:
            'Got it, Daniel. The front desk will call you tomorrow to talk options and book an assessment. Anything else?',
          offsetSec: 34,
        },
        { role: 'user', content: 'Nope, thanks!', offsetSec: 46 },
      ],
      events: [
        {
          type: 'tool_call',
          toolName: 'take_message',
          argsJson: {
            name: 'Daniel Okafor',
            phone: '+1 (555) 019-3312',
            message:
              'Runner with recurring knee pain, asking if the clinic treats this. Wants a callback.',
          },
          resultJson: { saved: true },
          offsetSec: 40,
        },
      ],
    },
    {
      channel: VoiceCallChannel.BROWSER,
      status: VoiceCallStatus.COMPLETED,
      outcome: VoiceCallOutcome.INFO_PROVIDED,
      callerName: 'Caller',
      callerPhone: null,
      daysAgo: 2,
      hour: 10,
      minute: 12,
      durationSec: 43,
      summary:
        'Caller asked about opening hours and parking. Told hours (Mon–Fri 9–5, Sat 10–2) and that free parking is available behind the building. No booking requested.',
      transcript: [
        {
          role: 'assistant',
          content: 'Thanks for calling Everwell, this is Ava. How can I help?',
          offsetSec: 0,
        },
        { role: 'user', content: 'What are your hours, and is there parking?', offsetSec: 5 },
        {
          role: 'assistant',
          content:
            "We're open Monday to Friday 9 to 5, and Saturday 10 to 2. There's free parking in the lot behind the building. Would you like to book a visit while you're here?",
          offsetSec: 11,
        },
        { role: 'user', content: 'Not yet, just checking. Thanks!', offsetSec: 30 },
        { role: 'assistant', content: 'Anytime: talk soon!', offsetSec: 36 },
      ],
      events: [
        {
          type: 'tool_call',
          toolName: 'get_clinic_info',
          argsJson: { topic: 'hours_and_parking' },
          resultJson: { hours: 'Mon-Fri 9-5, Sat 10-2', parking: 'free lot behind building' },
          offsetSec: 8,
        },
      ],
    },
    {
      channel: VoiceCallChannel.PHONE,
      status: VoiceCallStatus.TRANSFERRED,
      outcome: VoiceCallOutcome.TRANSFERRED_TO_HUMAN,
      callerName: 'Marcus Chen',
      callerPhone: '+1 (555) 011-4408',
      patientEmail: 'marcus.chen@everwell.demo',
      daysAgo: 1,
      hour: 13,
      minute: 27,
      durationSec: 96,
      summary:
        'Marcus Chen disputed a charge on his last invoice (partial refund not reflected). Beyond the assistant’s scope; transferred to the front desk / accounting.',
      transcript: [
        {
          role: 'assistant',
          content: 'Thanks for calling Everwell, this is Ava. How can I help?',
          offsetSec: 0,
        },
        {
          role: 'user',
          content: 'I was charged the full amount but I was supposed to get a partial refund.',
          offsetSec: 6,
        },
        { role: 'assistant', content: "I'm sorry about that. Can I get your name?", offsetSec: 14 },
        { role: 'user', content: 'Marcus Chen.', offsetSec: 19 },
        {
          role: 'assistant',
          content:
            "Thanks, Marcus. Billing adjustments and refunds are handled by our team directly. I don't want to guess on your money. Let me connect you to the front desk now. One moment.",
          offsetSec: 25,
        },
        { role: 'user', content: 'Okay, thank you.', offsetSec: 40 },
      ],
      events: [
        {
          type: 'tool_call',
          toolName: 'lookup_patient',
          argsJson: { name: 'Marcus Chen' },
          resultJson: { found: true, patient: 'marcus.chen@everwell.demo' },
          offsetSec: 21,
        },
        {
          type: 'transfer',
          toolName: 'transfer_to_human',
          argsJson: { reason: 'billing dispute / refund', to: 'front desk' },
          resultJson: { transferred: true },
          offsetSec: 44,
        },
      ],
    },
    {
      channel: VoiceCallChannel.BROWSER,
      status: VoiceCallStatus.ABANDONED,
      outcome: VoiceCallOutcome.NO_ACTION,
      callerName: 'Caller',
      callerPhone: null,
      daysAgo: 1,
      hour: 17,
      minute: 3,
      durationSec: 9,
      summary: 'Caller hung up shortly after the greeting before stating a request.',
      transcript: [
        {
          role: 'assistant',
          content: 'Thanks for calling Everwell, this is Ava. How can I help you today?',
          offsetSec: 0,
        },
        { role: 'user', content: '(call ended)', offsetSec: 9 },
      ],
      events: [],
    },
  ]

  let callsCreated = 0
  let eventsCreated = 0
  for (const def of calls) {
    const startedAt = daysFromNow(-def.daysAgo, def.hour, def.minute)
    const endedAt = new Date(startedAt.getTime() + def.durationSec * 1000)
    const transcript = def.transcript.map((t) => ({
      role: t.role,
      content: t.content,
      ts: new Date(startedAt.getTime() + t.offsetSec * 1000).toISOString(),
    }))

    const call = await prisma.voiceCall.create({
      data: {
        clinicId,
        channel: def.channel,
        status: def.status,
        outcome: def.outcome ?? undefined,
        callerName: def.callerName,
        callerPhone: def.callerPhone,
        patientId: def.patientEmail ? patientId(def.patientEmail) : null,
        startedAt,
        endedAt,
        durationSec: def.durationSec,
        transcript,
        summary: def.summary,
      },
    })
    callsCreated++

    for (const ev of def.events) {
      await prisma.voiceCallEvent.create({
        data: {
          callId: call.id,
          type: ev.type,
          toolName: ev.toolName,
          argsJson: ev.argsJson ?? undefined,
          resultJson: ev.resultJson ?? undefined,
          errorMessage: ev.errorMessage,
          ts: new Date(startedAt.getTime() + ev.offsetSec * 1000),
        },
      })
      eventsCreated++
    }
  }

  console.log(
    `  ✓ Voice agent: config enabled, ${callsCreated} calls + ${eventsCreated} events (all outcomes)`
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n🌱 Medoflow Full Demo Universe Seed\n')
  console.log('Clinic: Everwell Longevity Clinic\n')

  // argon2id matches the verifier in authController.ts:69, keep them aligned
  // or logins silently fail at runtime even though hashes are valid.
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id })

  console.log('[0] Schema setup...')
  await setupMissingColumns()

  console.log('[1] Clinic & location...')
  const clinic = await upsertClinic()
  const location = await upsertLocation(clinic.id)

  console.log('[2] Disciplines...')
  const disciplines = await createDisciplines(clinic.id)

  console.log('[3] Services...')
  const services = await createServices(clinic.id, disciplines)

  console.log('[4] Products, packages, memberships...')
  const products = await createProducts(clinic.id)
  const packages = await createPackages(clinic.id)
  const memberships = await createMemberships(clinic.id)

  console.log('[5] Users...')
  const users = await createUsers(clinic.id, passwordHash)

  console.log('[6] Providers...')
  const providers = await createProviders(clinic.id, users, disciplines, services, location.id)

  console.log('[7] Commission rules...')
  const commissionRules = await createCommissionRules(clinic.id, providers)

  console.log('[8] Clinical history...')
  const frontDeskUserId = users['jordan@everwell.demo']?.id ?? ''
  await createClinicalHistory({
    clinicId: clinic.id,
    locationId: location.id,
    users,
    providers,
    services,
    products,
    commissionRules,
    frontDeskUserId,
  })

  console.log('[9] Patient entitlements...')
  await createEntitlements({ clinicId: clinic.id, users, packages, memberships })

  console.log('[10] Standalone commerce invoices...')
  await createStandaloneCommerceInvoices({
    clinicId: clinic.id,
    users,
    packages,
    memberships,
    providers,
    frontDeskUserId,
  })

  console.log('[11] Prebuilt carts...')
  await createPrebuiltCarts({ clinicId: clinic.id, users, products })

  console.log('[12] Completed commerce orders...')
  await createCompletedCommerceOrders({
    clinicId: clinic.id,
    users,
    products,
    providers,
    frontDeskUserId,
  })

  console.log('[13] AI Front Desk (voice agent) config + call log...')
  await createVoiceAgentData({ clinicId: clinic.id, users })

  console.log('\n✅ Demo universe seed complete!\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Clinic:     Everwell Longevity Clinic')
  console.log('  Password:   Demo1234!  (all accounts)\n')
  console.log('  PLATFORM_ADMIN  platform@medoflow.demo  Pat Okafor (cross-tenant)')
  console.log('  SUPER_ADMIN     alex@everwell.demo      Alex Thornton')
  console.log('  FRONT_DESK      jordan@everwell.demo    Jordan Walsh')
  console.log('  ACCOUNTING      taylor@everwell.demo    Taylor Brooks')
  console.log('  MARKETING       casey@everwell.demo     Casey Morgan')
  console.log('  STAFF           robin@everwell.demo     Robin Lee (Clinic Coordinator)')
  console.log('  PROVIDER    sarah@everwell.demo      Dr. Sarah Chen')
  console.log('  PROVIDER    marcus@everwell.demo     Dr. Marcus Rivera')
  console.log('  PROVIDER    priya@everwell.demo      Dr. Priya Patel')
  console.log('  PROVIDER    james@everwell.demo      Coach James Wright')
  console.log('  PATIENT     emma@everwell.demo       Emma Hartwell (hero)')
  console.log('  PATIENT     liam@everwell.demo       Liam Nakamura (outstanding invoice)')
  console.log('  PATIENT     sophia@everwell.demo     Sophia Martinez (refund example)')
  console.log('  PATIENT     marcus.chen@everwell.demo Marcus Chen (partial refund)')
  console.log('  ... and 11 more patients')
  console.log('')
  console.log('  AI Front Desk: enabled · 8 demo calls at /dashboard/voice-agent')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
