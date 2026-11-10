/**
 * Dev seed — idempotent login creds for every role.
 *
 * Why this file exists:
 *   • The real auth pipeline hashes with argon2 (services/authService.ts).
 *   • The schema added a required Tenant → Clinic relation
 *     (migration 20260419000000_add_tenant_model).
 *
 * So the previous bcrypt + no-tenant seed silently produced users who
 * couldn't actually log in. This rewrite matches the live pipeline.
 *
 * Run: `npx ts-node prisma/seed.ts`
 */

import { PrismaClient, Role } from '@prisma/client'
import * as argon2 from 'argon2'

const prisma = new PrismaClient()

// Shared password for every dev user — never ship this anywhere real.
const PASSWORD = 'test1234'

type SeedUser = {
  email: string
  name: string
  role: Role
  withinClinic: boolean // false only for the platform admin
}

const users: SeedUser[] = [
  {
    email: 'platform@medoflow.test',
    name: 'Platform Admin',
    role: 'PLATFORM_ADMIN',
    withinClinic: false,
  },
  { email: 'admin@medoflow.test', name: 'Clinic Owner', role: 'SUPER_ADMIN', withinClinic: true },
  { email: 'doctor@medoflow.test', name: 'Dr. Chen', role: 'PROVIDER', withinClinic: true },
  { email: 'frontdesk@medoflow.test', name: 'Front Desk', role: 'FRONT_DESK', withinClinic: true },
  { email: 'patient@medoflow.test', name: 'Anika Patel', role: 'PATIENT', withinClinic: true },
]

async function main() {
  // 1) Tenant — required by Clinic since migration 20260419.
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    create: {
      name: 'Demo Tenant',
      slug: 'demo',
      verificationStatus: 'APPROVED',
    },
    update: {},
  })

  // 2) Clinic — owned by the tenant, is the "home" for non-platform users.
  const clinic = await prisma.clinic.upsert({
    where: { id: await resolveClinicId(tenant.id) },
    create: {
      id: `clinic_${tenant.id.slice(-8)}`,
      tenantId: tenant.id,
      name: 'Demo Clinic',
      email: 'hello@democlinic.test',
    },
    update: {},
  })

  // 3) Users — idempotent upserts; password is always re-hashed so you can
  //    rerun to reset credentials without wiping the DB.
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id })

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        password: hash,
        clinicId: u.withinClinic ? clinic.id : null,
      },
      update: {
        name: u.name,
        role: u.role,
        password: hash,
        clinicId: u.withinClinic ? clinic.id : null,
      },
    })
  }

  // 4) Storefront catalogue — products, packages, memberships on the Demo
  //    Clinic so /store has something to render out of the box.
  await seedCatalogue(clinic.id)

  // 5) Booking prerequisites — location, discipline, services, providers,
  //    availability windows so the in-nav Book Appointment modal has real
  //    data to render against.
  await seedBookingWorld(clinic.id)

  print(tenant.name, clinic.name)
}

async function seedBookingWorld(clinicId: string) {
  // Location — use a primary clinical facility so the front-end can default
  // to it when creating slot holds / appointments.
  const location = await prisma.location.upsert({
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

  const discipline = await prisma.discipline.upsert({
    where: { clinicId_name: { clinicId, name: 'Primary Care' } },
    update: { isActive: true, isArchived: false },
    create: {
      clinicId,
      name: 'Primary Care',
      description: 'General adult medicine and wellness consultations.',
    },
  })

  const serviceDefs = [
    { name: 'New Patient Consultation', duration: 45, price: 180, notice: 60 },
    { name: 'Follow-up Visit', duration: 30, price: 120, notice: 60 },
    { name: 'Annual Wellness Exam', duration: 60, price: 220, notice: 120 },
    { name: 'Telehealth Check-in', duration: 20, price: 85, notice: 30 },
  ]

  const services: { id: string; name: string }[] = []
  for (const s of serviceDefs) {
    const svc = await prisma.service.upsert({
      where: { clinicId_name: { clinicId, name: s.name } },
      update: {
        duration: s.duration,
        defaultPrice: s.price,
        minimumNoticeMinutes: s.notice,
        isActive: true,
        isArchived: false,
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
      },
    })
    services.push({ id: svc.id, name: svc.name })
  }

  // Providers — one linked to the doctor@medoflow.test user so the provider
  // has an authenticatable staff account, plus a second solo provider so the
  // "Any provider" flow has something to pick from.
  const doctorUser = await prisma.user.findUnique({ where: { email: 'doctor@medoflow.test' } })
  const providerDefs: Array<{
    firstName: string
    lastName: string
    email: string
    userId: string | null
  }> = [
    {
      firstName: 'Evelyn',
      lastName: 'Chen',
      email: 'doctor@medoflow.test',
      userId: doctorUser?.id ?? null,
    },
    {
      firstName: 'Marcus',
      lastName: 'Patel',
      email: 'marcus.patel@medoflow.test',
      userId: null,
    },
  ]

  for (const def of providerDefs) {
    // Provider has no natural unique key other than (userId) when present,
    // so we find-or-create by name+clinic to stay idempotent.
    const existing = await prisma.provider.findFirst({
      where: { clinicId, firstName: def.firstName, lastName: def.lastName },
    })
    const provider =
      existing ??
      (await prisma.provider.create({
        data: {
          clinicId,
          userId: def.userId,
          firstName: def.firstName,
          lastName: def.lastName,
          email: def.email,
          isActive: true,
        },
      }))

    // Attach the discipline.
    await prisma.providerDiscipline.upsert({
      where: { providerId_disciplineId: { providerId: provider.id, disciplineId: discipline.id } },
      update: {},
      create: { providerId: provider.id, disciplineId: discipline.id },
    })

    // Offer every service.
    for (const svc of services) {
      await prisma.providerService.upsert({
        where: { providerId_serviceId: { providerId: provider.id, serviceId: svc.id } },
        update: {},
        create: { providerId: provider.id, serviceId: svc.id },
      })
    }

    // Assign to the primary location.
    await prisma.providerLocationAssignment.upsert({
      where: { providerId_locationId: { providerId: provider.id, locationId: location.id } },
      update: { isPrimary: true },
      create: { providerId: provider.id, locationId: location.id, isPrimary: true },
    })

    // Availability — Monday–Friday, 9:00–17:00 local.
    const existingAvail = await prisma.providerAvailability.findMany({
      where: { providerId: provider.id },
      select: { weekday: true },
    })
    const haveWeekdays = new Set(existingAvail.map((a) => a.weekday))
    for (const weekday of [1, 2, 3, 4, 5]) {
      if (haveWeekdays.has(weekday)) continue
      await prisma.providerAvailability.create({
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
}

async function seedCatalogue(clinicId: string) {
  const products = [
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

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { clinicId_name: { clinicId, name: p.name } },
      update: { description: p.desc, sku: p.sku, price: p.price, isActive: true },
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
      update: { quantityInStock: p.qty, reorderThreshold: 8 },
      create: { clinicId, productId: product.id, quantityInStock: p.qty, reorderThreshold: 8 },
    })
  }

  const packages = [
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
  for (const pkg of packages) {
    await prisma.package.upsert({
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

  const memberships = [
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
  for (const m of memberships) {
    await prisma.membership.upsert({
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

/**
 * Clinic rows don't have a natural unique key other than id; we derive a
 * deterministic id from the tenant so upsert is truly idempotent.
 */
async function resolveClinicId(tenantId: string): Promise<string> {
  return `clinic_${tenantId.slice(-8)}`
}

function print(tenantName: string, clinicName: string) {
  const line = '─'.repeat(54)
  const rows = users
    .map((u) => `  ${u.role.padEnd(16)} ${u.email.padEnd(28)} ${PASSWORD}`)
    .join('\n')
  /* eslint-disable no-console */
  console.log(`\n${line}\nSeed complete — tenant: ${tenantName} / clinic: ${clinicName}\n${line}`)
  console.log('Login with any of these (shared password):')
  console.log(rows)
  console.log(line + '\n')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
