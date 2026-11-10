/**
 * Demo seed — full platform flow: platform admin → tenant/clinic → providers → services → patient → published page.
 * Run from backend/: DATABASE_URL="..." npx ts-node --transpile-only prisma/seed-demo.ts
 */

import {
  PrismaClient,
  Role,
  AppointmentStatus,
  InvoiceStatus,
  SitePageStatus,
} from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

const PLATFORM_ADMIN_EMAIL = 'admin@medoflow.io'
const PLATFORM_ADMIN_PASS = 'Admin@123!'
const CLINIC_OWNER_EMAIL = 'owner@greenpine.clinic'
const CLINIC_OWNER_PASS = 'Owner@123!'
const PATIENT_EMAIL = 'patient@demo.com'
const PATIENT_PASS = 'Patient@123!'

async function hashPw(p: string) {
  return argon2.hash(p)
}

async function main() {
  console.log('🌱 Seeding MedoFlow demo data…\n')

  // ─── 1. Platform admin (no clinic affiliation) ────────────────────────────
  console.log('1. Platform admin…')
  const platformAdmin = await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    update: {},
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      password: await hashPw(PLATFORM_ADMIN_PASS),
      name: 'Super Admin',
      role: Role.PLATFORM_ADMIN,
      isActive: true,
    },
  })
  console.log(`   ✓ ${platformAdmin.email}`)

  // ─── 2. Tenant + Brand + Clinic ───────────────────────────────────────────
  console.log('2. Tenant (Green Pine Clinic)…')

  let tenant = await prisma.tenant.findFirst({ where: { slug: 'greenpine' } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Green Pine Medical Group',
        slug: 'greenpine',
        plan: 'GROWTH' as any,
        status: 'ACTIVE' as any,
        termsAcceptedAt: new Date(),
        termsAcceptedByUserId: platformAdmin.id,
        termsVersion: 'v1-2026-05',
        onboardingStep: 7,
        onboardingCompletedAt: new Date(),
        verificationStatus: 'APPROVED',
      },
    })
  }
  console.log(`   ✓ Tenant: ${tenant.id}`)

  // Brand (subdomain required + unique)
  let brand = await prisma.brand.findUnique({ where: { tenantId: tenant.id } })
  if (!brand) {
    brand = await prisma.brand.create({
      data: {
        tenantId: tenant.id,
        subdomain: 'greenpine',
        logoUrl: 'https://placehold.co/120x40/0D9488/white?text=GreenPine',
        primaryColor: '#0D9488',
        secondaryColor: '#065f46',
      },
    })
  }

  // Clinic (email required)
  let clinic = await prisma.clinic.findFirst({ where: { tenantId: tenant.id } })
  if (!clinic) {
    clinic = await prisma.clinic.create({
      data: {
        tenantId: tenant.id,
        name: 'Green Pine Medical Group',
        email: 'info@greenpine.clinic',
        slug: 'greenpine',
        themeColor: '#0D9488',
        logoUrl: 'https://placehold.co/120x40/0D9488/white?text=GreenPine',
      },
    })
  }
  console.log(`   ✓ Clinic: ${clinic.id} (slug: ${clinic.slug})`)

  // Location
  let location = await prisma.location.findFirst({ where: { clinicId: clinic.id } })
  if (!location) {
    location = await prisma.location.create({
      data: {
        clinicId: clinic.id,
        name: 'Main Office',
        address: '1400 Pine St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94109',
        phone: '(415) 555-0100',
        timezone: 'America/Los_Angeles',
        isActive: true,
      },
    })
  }
  console.log(`   ✓ Location: ${location.name}`)

  // ─── 3. Clinic owner (SUPER_ADMIN) ────────────────────────────────────────
  console.log('3. Clinic owner…')
  const owner = await prisma.user.upsert({
    where: { email: CLINIC_OWNER_EMAIL },
    update: {},
    create: {
      email: CLINIC_OWNER_EMAIL,
      password: await hashPw(CLINIC_OWNER_PASS),
      name: 'Emily Chen',
      role: Role.SUPER_ADMIN,
      isActive: true,
      clinicId: clinic.id,
    },
  })
  console.log(`   ✓ ${owner.email}`)

  // ─── 4. Discipline (clinic-scoped) ────────────────────────────────────────
  console.log('4. Discipline…')
  const discipline =
    (await prisma.discipline.findFirst({ where: { clinicId: clinic.id } })) ??
    (await prisma.discipline.create({
      data: { clinicId: clinic.id, name: 'General Practice', isActive: true },
    }))
  console.log(`   ✓ ${discipline.name}`)

  // ─── 5. ScribeTemplate (system generic) ───────────────────────────────────
  console.log('5. Scribe templates…')
  const genericTemplate = await prisma.scribeTemplate.findFirst({
    where: { specialty: 'GENERIC', clinicId: null },
  })
  console.log(
    `   ✓ ${genericTemplate ? `Generic: ${genericTemplate.id}` : '(none — migration seed may be missing)'}`
  )

  // ─── 6. Two providers ─────────────────────────────────────────────────────
  console.log('6. Providers…')
  const dr1User = await prisma.user.upsert({
    where: { email: 'dr.james@greenpine.clinic' },
    update: {},
    create: {
      email: 'dr.james@greenpine.clinic',
      password: await hashPw('Provider@123!'),
      name: 'James Wilson',
      role: Role.PROVIDER,
      isActive: true,
      clinicId: clinic.id,
    },
  })
  const provider1 = await prisma.provider.upsert({
    where: { userId: dr1User.id },
    update: {},
    create: {
      userId: dr1User.id,
      clinicId: clinic.id,
      firstName: 'James',
      lastName: 'Wilson',
      email: 'dr.james@greenpine.clinic',
      bio: 'Board-certified in family medicine with 15 years of practice. Passionate about preventive care and patient education.',
      headshotUrl: 'https://i.pravatar.cc/300?img=12',
      licenseNumber: 'CA-MD-102938',
      languages: ['English', 'Spanish'],
      scribeTone: 'CONCISE',
      scribeTemplateId: genericTemplate?.id ?? null,
      scribeIncludeCoding: true,
    },
  })
  // ProviderDiscipline junction
  await prisma.providerDiscipline.upsert({
    where: { providerId_disciplineId: { providerId: provider1.id, disciplineId: discipline.id } },
    update: {},
    create: { providerId: provider1.id, disciplineId: discipline.id },
  })
  console.log(`   ✓ Dr. James Wilson`)

  const dr2User = await prisma.user.upsert({
    where: { email: 'dr.priya@greenpine.clinic' },
    update: {},
    create: {
      email: 'dr.priya@greenpine.clinic',
      password: await hashPw('Provider@123!'),
      name: 'Priya Sharma',
      role: Role.PROVIDER,
      isActive: true,
      clinicId: clinic.id,
    },
  })
  const provider2 = await prisma.provider.upsert({
    where: { userId: dr2User.id },
    update: {},
    create: {
      userId: dr2User.id,
      clinicId: clinic.id,
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'dr.priya@greenpine.clinic',
      bio: 'Specializing in integrative medicine and chronic disease management. Trained at UCSF and Mayo Clinic.',
      headshotUrl: 'https://i.pravatar.cc/300?img=47',
      licenseNumber: 'CA-MD-884921',
      languages: ['English', 'Hindi', 'Tamil'],
      scribeTone: 'DETAILED',
      scribeTemplateId: genericTemplate?.id ?? null,
      scribeIncludeCoding: true,
    },
  })
  await prisma.providerDiscipline.upsert({
    where: { providerId_disciplineId: { providerId: provider2.id, disciplineId: discipline.id } },
    update: {},
    create: { providerId: provider2.id, disciplineId: discipline.id },
  })
  console.log(`   ✓ Dr. Priya Sharma`)

  // ─── 7. Services ──────────────────────────────────────────────────────────
  console.log('7. Services…')
  const svcData = [
    { name: 'Annual Physical Exam', duration: 60, defaultPrice: 150 },
    { name: 'Sick Visit', duration: 30, defaultPrice: 85 },
    { name: 'Telehealth Consult', duration: 20, defaultPrice: 65 },
    { name: 'Chronic Care Management', duration: 45, defaultPrice: 120 },
    { name: 'Mental Health Screening', duration: 40, defaultPrice: 95 },
  ]
  const services = await Promise.all(
    svcData.map((svc) =>
      prisma.service.upsert({
        where: { clinicId_name: { clinicId: clinic.id, name: svc.name } },
        update: {},
        create: {
          clinicId: clinic.id,
          disciplineId: discipline.id,
          name: svc.name,
          duration: svc.duration,
          defaultPrice: svc.defaultPrice,
          isActive: true,
        },
      })
    )
  )
  console.log(`   ✓ ${services.length} services`)

  // ─── 8. Patient ───────────────────────────────────────────────────────────
  console.log('8. Patient…')
  const patient = await prisma.user.upsert({
    where: { email: PATIENT_EMAIL },
    update: {},
    create: {
      email: PATIENT_EMAIL,
      password: await hashPw(PATIENT_PASS),
      name: 'Alex Rivera',
      role: Role.PATIENT,
      isActive: true,
      clinicId: clinic.id,
    },
  })
  console.log(`   ✓ ${patient.email}`)

  // ─── 9. Appointments & Invoices ───────────────────────────────────────────
  console.log('9. Appointments & invoices…')
  const pastStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const pastEnd = new Date(pastStart.getTime() + 60 * 60 * 1000)

  const pastAppt = await prisma.appointment.upsert({
    where: { id: 'seed-appt-past-001' },
    update: {},
    create: {
      id: 'seed-appt-past-001',
      clinicId: clinic.id,
      patientId: patient.id,
      providerId: provider1.id,
      serviceId: services[0].id,
      locationId: location.id,
      startTime: pastStart,
      endTime: pastEnd,
      status: AppointmentStatus.COMPLETED,
      priceAtBooking: 150,
      notes: 'Annual physical completed. Labs ordered. Follow-up in 6 months.',
    },
  })

  await prisma.invoice.upsert({
    where: { id: 'seed-inv-001' },
    update: {},
    create: {
      id: 'seed-inv-001',
      clinicId: clinic.id,
      patientId: patient.id,
      appointmentId: pastAppt.id,
      providerId: provider1.id,
      subtotal: 150,
      taxAmount: 0,
      totalAmount: 150,
      status: InvoiceStatus.PAID,
    },
  })

  const futureStart = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
  const futureEnd = new Date(futureStart.getTime() + 45 * 60 * 1000)
  await prisma.appointment.upsert({
    where: { id: 'seed-appt-future-001' },
    update: {},
    create: {
      id: 'seed-appt-future-001',
      clinicId: clinic.id,
      patientId: patient.id,
      providerId: provider2.id,
      serviceId: services[3].id,
      locationId: location.id,
      startTime: futureStart,
      endTime: futureEnd,
      status: AppointmentStatus.CONFIRMED,
      priceAtBooking: 120,
    },
  })
  console.log(`   ✓ 2 appointments, 1 paid invoice`)

  // ─── 10. Published Home page ──────────────────────────────────────────────
  console.log('10. Published site page…')
  const sectionsJson = [
    {
      id: 's_hero001',
      type: 'hero',
      settings: {
        eyebrow: 'Welcome to Green Pine Medical Group',
        headline: 'Healthcare that fits your life.',
        subheadline:
          'Book a visit, message your provider, and manage your care from one place. Same-day visits available most weekdays.',
        ctaLabel: 'Book a visit',
        ctaHref: '#services',
        backgroundImage: '',
      },
    },
    {
      id: 's_services001',
      type: 'service-grid',
      settings: {
        title: 'What we offer',
        intro: 'Tap a service to see availability.',
        maxItems: 6,
      },
    },
    {
      id: 's_providers001',
      type: 'provider-bios',
      settings: {
        title: 'Meet our team',
        intro: 'Experienced, compassionate providers ready to help.',
        maxItems: 4,
      },
    },
    {
      id: 's_testimonials001',
      type: 'testimonials',
      settings: {
        title: 'What our patients say',
        quotes: [
          '"Saved me hours of paperwork. Booking online is so easy." — Sarah M.',
          '"Dr. Wilson actually listens and explains everything clearly." — James T.',
          '"Best clinic experience I\'ve had in years. Highly recommend!" — Priya K.',
          '"The telehealth option is a lifesaver for busy parents." — Diego R.',
        ],
      },
    },
    {
      id: 's_faq001',
      type: 'faq',
      settings: {
        title: 'Frequently asked',
        items: [
          'Do you accept insurance?|We bill most major insurers — bring your insurance card to your first visit.',
          'How do I cancel an appointment?|Open Appointments in your account menu and cancel up to 24 hours in advance.',
          'Is telehealth available?|Yes — video visits are available for most non-urgent concerns at $65 per session.',
          'Do you offer same-day appointments?|We reserve several slots each day for urgent care needs.',
        ],
      },
    },
    {
      id: 's_cta001',
      type: 'booking-cta',
      settings: {
        headline: 'Ready to take control of your health?',
        subheadline: 'Same-day visits available most weekdays. Your care team is waiting.',
        ctaLabel: 'Book an appointment',
        ctaHref: '#services',
      },
    },
  ]

  await prisma.sitePage.upsert({
    where: { id: 'seed-page-home-001' },
    update: {},
    create: {
      id: 'seed-page-home-001',
      clinicId: clinic.id,
      slug: 'home',
      title: 'Home',
      status: SitePageStatus.PUBLISHED,
      sectionsJson: sectionsJson as any,
      draftSectionsJson: sectionsJson as any,
      publishedAt: new Date(),
      seoTitle: 'Green Pine Medical Group — Healthcare that fits your life',
      seoDescription: 'Book a visit, message your provider, and manage your care from one place.',
    },
  })
  console.log(`   ✓ Home page published`)

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  SEED COMPLETE — credentials')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Platform admin   ${PLATFORM_ADMIN_EMAIL}  /  ${PLATFORM_ADMIN_PASS}`)
  console.log(`  Clinic owner     ${CLINIC_OWNER_EMAIL}  /  ${CLINIC_OWNER_PASS}`)
  console.log(`  Provider 1       dr.james@greenpine.clinic  /  Provider@123!`)
  console.log(`  Provider 2       dr.priya@greenpine.clinic  /  Provider@123!`)
  console.log(`  Patient          ${PATIENT_EMAIL}  /  ${PATIENT_PASS}`)
  console.log()
  console.log(`  Clinic ID        ${clinic.id}`)
  console.log(`  Clinic slug      greenpine`)
  console.log()
  console.log(`  Public home      http://localhost:3000/clinic/${clinic.id}/p/home`)
  console.log(`  Clinic landing   http://localhost:3000/clinic/${clinic.id}`)
  console.log(`  Site builder     http://localhost:3000/dashboard/site/pages`)
  console.log(`  Platform admin   http://localhost:3000/platform/clinics`)
  console.log('═══════════════════════════════════════════════════\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
