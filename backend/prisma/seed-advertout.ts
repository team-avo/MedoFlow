/**
 * Advertout demo clinic seed: provisions a full clinic for CEO demo.
 * Run from backend/:
 *   DATABASE_URL="postgresql://postgres:<pw>@tramway.proxy.rlwy.net:41439/railway?schema=public" \
 *     npx ts-node --transpile-only prisma/seed-advertout.ts
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
const CLINIC_OWNER_EMAIL = 'owner@advertout.com'
const CLINIC_OWNER_PASS = 'advertout'
const DR1_EMAIL = 'dr.rahul@advertout.com'
const DR2_EMAIL = 'dr.ananya@advertout.com'
const PATIENT_EMAIL = 'patient@advertout.com'
const PATIENT_PASS = 'advertout'

async function hashPw(p: string) {
  return argon2.hash(p)
}

async function main() {
  console.log('🌱 Seeding Advertout demo clinic on PRODUCTION…\n')

  // ─── 1. Platform admin ────────────────────────────────────────────────────
  console.log('1. Platform admin…')
  const platformAdmin = await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    update: {},
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      password: await hashPw(PLATFORM_ADMIN_PASS),
      name: 'MedoFlow Admin',
      role: Role.PLATFORM_ADMIN,
      isActive: true,
    },
  })
  console.log(`   ✓ ${platformAdmin.email}`)

  // ─── 2. Tenant + Brand + Clinic ───────────────────────────────────────────
  console.log('2. Tenant (Advertout Digital Agency)…')

  let tenant = await prisma.tenant.findFirst({ where: { slug: 'advertout' } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Advertout Digital Agency',
        slug: 'advertout',
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

  let brand = await prisma.brand.findUnique({ where: { tenantId: tenant.id } })
  if (!brand) {
    brand = await prisma.brand.create({
      data: {
        tenantId: tenant.id,
        subdomain: 'advertout',
        logoUrl: 'https://placehold.co/120x40/7C3AED/white?text=Advertout',
        primaryColor: '#7C3AED',
        secondaryColor: '#4C1D95',
      },
    })
  }

  let clinic = await prisma.clinic.findFirst({ where: { tenantId: tenant.id } })
  if (!clinic) {
    clinic = await prisma.clinic.create({
      data: {
        tenantId: tenant.id,
        name: 'Advertout Wellness Clinic',
        email: 'clinic@advertout.com',
        slug: 'advertout',
        themeColor: '#7C3AED',
        logoUrl: 'https://placehold.co/120x40/7C3AED/white?text=Advertout',
      },
    })
  }
  console.log(`   ✓ Clinic: ${clinic.id} (slug: ${clinic.slug})`)

  let location = await prisma.location.findFirst({ where: { clinicId: clinic.id } })
  if (!location) {
    location = await prisma.location.create({
      data: {
        clinicId: clinic.id,
        name: 'Advertout Main Branch',
        address: '42 MG Road',
        city: 'Bengaluru',
        state: 'KA',
        postalCode: '560001',
        phone: '+91 80 4567 8900',
        timezone: 'Asia/Kolkata',
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
      name: 'Abhinav Verma',
      role: Role.SUPER_ADMIN,
      isActive: true,
      clinicId: clinic.id,
    },
  })
  console.log(`   ✓ ${owner.email}`)

  // ─── 4. Discipline ────────────────────────────────────────────────────────
  console.log('4. Discipline…')
  const discipline =
    (await prisma.discipline.findFirst({ where: { clinicId: clinic.id } })) ??
    (await prisma.discipline.create({
      data: { clinicId: clinic.id, name: 'General Practice', isActive: true },
    }))
  console.log(`   ✓ ${discipline.name}`)

  // ─── 5. Scribe template ───────────────────────────────────────────────────
  const genericTemplate = await prisma.scribeTemplate.findFirst({
    where: { specialty: 'GENERIC', clinicId: null },
  })

  // ─── 6. Two providers ─────────────────────────────────────────────────────
  console.log('6. Providers…')
  const dr1User = await prisma.user.upsert({
    where: { email: DR1_EMAIL },
    update: {},
    create: {
      email: DR1_EMAIL,
      password: await hashPw('advertout'),
      name: 'Rahul Mehta',
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
      firstName: 'Rahul',
      lastName: 'Mehta',
      email: DR1_EMAIL,
      bio: 'MBBS, MD, 12 years in family medicine. Passionate about preventive care and digital health.',
      headshotUrl: 'https://i.pravatar.cc/300?img=11',
      licenseNumber: 'MH-MD-20340',
      languages: ['English', 'Hindi', 'Marathi'],
      scribeTone: 'CONCISE',
      scribeTemplateId: genericTemplate?.id ?? null,
      scribeIncludeCoding: true,
    },
  })
  await prisma.providerDiscipline.upsert({
    where: { providerId_disciplineId: { providerId: provider1.id, disciplineId: discipline.id } },
    update: {},
    create: { providerId: provider1.id, disciplineId: discipline.id },
  })
  console.log(`   ✓ Dr. Rahul Mehta`)

  const dr2User = await prisma.user.upsert({
    where: { email: DR2_EMAIL },
    update: {},
    create: {
      email: DR2_EMAIL,
      password: await hashPw('advertout'),
      name: 'Ananya Singh',
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
      firstName: 'Ananya',
      lastName: 'Singh',
      email: DR2_EMAIL,
      bio: "Specialising in integrative medicine, women's health, and chronic disease management. AIIMS trained.",
      headshotUrl: 'https://i.pravatar.cc/300?img=49',
      licenseNumber: 'DL-MD-77821',
      languages: ['English', 'Hindi', 'Punjabi'],
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
  console.log(`   ✓ Dr. Ananya Singh`)

  // ─── 7. Services ──────────────────────────────────────────────────────────
  console.log('7. Services…')
  const svcData = [
    { name: 'Full Body Checkup', duration: 60, defaultPrice: 1500 },
    { name: 'Sick Visit / Fever', duration: 30, defaultPrice: 800 },
    { name: 'Video Consultation', duration: 20, defaultPrice: 600 },
    { name: 'Chronic Care Management', duration: 45, defaultPrice: 1200 },
    { name: 'Mental Wellness Session', duration: 50, defaultPrice: 1000 },
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
      name: 'Demo Patient',
      role: Role.PATIENT,
      isActive: true,
      clinicId: clinic.id,
    },
  })
  console.log(`   ✓ ${patient.email}`)

  // ─── 9. Appointments & Invoices ───────────────────────────────────────────
  console.log('9. Appointments & invoices…')
  const pastStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const pastEnd = new Date(pastStart.getTime() + 60 * 60 * 1000)

  const pastAppt = await prisma.appointment.upsert({
    where: { id: 'ao-appt-past-001' },
    update: {},
    create: {
      id: 'ao-appt-past-001',
      clinicId: clinic.id,
      patientId: patient.id,
      providerId: provider1.id,
      serviceId: services[0].id,
      locationId: location.id,
      startTime: pastStart,
      endTime: pastEnd,
      status: AppointmentStatus.COMPLETED,
      priceAtBooking: 1500,
      notes: 'Full body checkup completed. All vitals normal. Recommended follow-up in 6 months.',
    },
  })

  await prisma.invoice.upsert({
    where: { id: 'ao-inv-001' },
    update: {},
    create: {
      id: 'ao-inv-001',
      clinicId: clinic.id,
      patientId: patient.id,
      appointmentId: pastAppt.id,
      providerId: provider1.id,
      subtotal: 1500,
      taxAmount: 0,
      totalAmount: 1500,
      status: InvoiceStatus.PAID,
    },
  })

  const futureStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const futureEnd = new Date(futureStart.getTime() + 20 * 60 * 1000)
  await prisma.appointment.upsert({
    where: { id: 'ao-appt-future-001' },
    update: {},
    create: {
      id: 'ao-appt-future-001',
      clinicId: clinic.id,
      patientId: patient.id,
      providerId: provider2.id,
      serviceId: services[2].id,
      locationId: location.id,
      startTime: futureStart,
      endTime: futureEnd,
      status: AppointmentStatus.CONFIRMED,
      priceAtBooking: 600,
    },
  })
  console.log(`   ✓ 2 appointments, 1 paid invoice`)

  // ─── 10. Published Home page ──────────────────────────────────────────────
  console.log('10. Published site page…')
  const sectionsJson = [
    {
      id: 'ao_hero001',
      type: 'hero',
      settings: {
        eyebrow: 'Welcome to Advertout Wellness Clinic',
        headline: 'Your health, our priority.',
        subheadline:
          'Book a consultation, connect with your doctor, and manage your health, all in one place. Same-day video visits available.',
        ctaLabel: 'Book an appointment',
        ctaHref: '#services',
        backgroundImage: '',
      },
    },
    {
      id: 'ao_services001',
      type: 'service-grid',
      settings: {
        title: 'Our services',
        intro: 'Choose a service to see availability and book instantly.',
        maxItems: 6,
      },
    },
    {
      id: 'ao_providers001',
      type: 'provider-bios',
      settings: {
        title: 'Meet our doctors',
        intro: 'Experienced, compassionate physicians ready to help.',
        maxItems: 4,
      },
    },
    {
      id: 'ao_testimonials001',
      type: 'testimonials',
      settings: {
        title: 'What our patients say',
        quotes: [
          '"Booking online was so easy, no waiting on hold!" - Priya S.',
          '"Dr. Mehta explained everything so clearly. Highly recommend!" - Rohan K.',
          '"The video consultation saved me so much time. Great experience." - Meena T.',
          '"Finally a clinic that has its act together digitally!" - Arun D.',
        ],
      },
    },
    {
      id: 'ao_faq001',
      type: 'faq',
      settings: {
        title: 'Frequently asked',
        items: [
          'Do you accept insurance?|We work with most major insurers. Bring your card to your first visit.',
          'How do I cancel an appointment?|Go to My Appointments in your account and cancel up to 2 hours before.',
          'Are video consultations available?|Yes: video visits are available for most non-emergency concerns at ₹600.',
          'Do you offer same-day appointments?|We keep slots open daily for urgent needs. Book early to grab one.',
        ],
      },
    },
    {
      id: 'ao_cta001',
      type: 'booking-cta',
      settings: {
        headline: 'Ready to take charge of your health?',
        subheadline: 'Same-day video visits available. Your care team is waiting.',
        ctaLabel: 'Book now',
        ctaHref: '#services',
      },
    },
  ]

  await prisma.sitePage.upsert({
    where: { id: 'ao-page-home-001' },
    update: {},
    create: {
      id: 'ao-page-home-001',
      clinicId: clinic.id,
      slug: 'home',
      title: 'Home',
      status: SitePageStatus.PUBLISHED,
      sectionsJson: sectionsJson as any,
      draftSectionsJson: sectionsJson as any,
      publishedAt: new Date(),
      seoTitle: 'Advertout Wellness Clinic: Your health, our priority',
      seoDescription:
        'Book a consultation, connect with your doctor, and manage your health all in one place.',
    },
  })
  console.log(`   ✓ Home page published`)

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  ADVERTOUT SEED COMPLETE: credentials')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Platform admin   ${PLATFORM_ADMIN_EMAIL}  /  ${PLATFORM_ADMIN_PASS}`)
  console.log(`  Clinic owner     ${CLINIC_OWNER_EMAIL}  /  ${CLINIC_OWNER_PASS}`)
  console.log(`  Provider 1       ${DR1_EMAIL}  /  advertout`)
  console.log(`  Provider 2       ${DR2_EMAIL}  /  advertout`)
  console.log(`  Patient          ${PATIENT_EMAIL}  /  ${PATIENT_PASS}`)
  console.log()
  console.log(`  Clinic ID        ${clinic.id}`)
  console.log(`  Clinic slug      advertout`)
  console.log()
  console.log(
    `  Public home      https://medoflow-production.up.railway.app/clinic/${clinic.id}/p/home`
  )
  console.log(`  Clinic landing   https://medoflow-production.up.railway.app/clinic/${clinic.id}`)
  console.log(`  Dashboard        https://medoflow-production.up.railway.app/dashboard`)
  console.log(`  Platform admin   https://medoflow-production.up.railway.app/platform/clinics`)
  console.log('═══════════════════════════════════════════════════\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
