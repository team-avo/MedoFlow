/**
 * Seeds one synthetic clinic for the live front-end ↔ back-end check of
 * Component 3 (frontend/e2e/live-records.spec.ts). Development databases
 * only — never point this at a database holding real data.
 *
 *   E2E_LIVE_PASSWORD=<any synthetic password> \
 *   DATABASE_URL=<owner url of a dev database> \
 *   npx ts-node --transpile-only scripts/seed-e2e-live.ts
 *
 * Prints the created ids and (example.test) emails as JSON.
 */
import crypto from 'crypto'
import * as argon2 from 'argon2'
import { Prisma, PrismaClient } from '@prisma/client'

const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? ''
if (!PASSWORD) {
  process.stderr.write('Set E2E_LIVE_PASSWORD (a synthetic password for the seeded users)\n')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production') {
  process.stderr.write('Refusing to seed synthetic users in production\n')
  process.exit(1)
}

const db = new PrismaClient()

async function main() {
  const suffix = crypto.randomBytes(3).toString('hex')
  const email = (role: string) => `${role}.live-${suffix}@example.test`
  const password = await argon2.hash(PASSWORD, { type: argon2.argon2id })
  const done = new Date('2026-01-01T00:00:00.000Z')

  const tenant = await db.tenant.create({
    data: {
      name: `Synthetic Live ${suffix}`,
      slug: `live-${suffix}`,
      onboardingStep: 9,
      onboardingCompletedAt: done,
      termsAcceptedAt: done,
      termsVersion: '1',
    },
  })
  const clinic = await db.clinic.create({
    data: {
      tenantId: tenant.id,
      name: `Live Clinic ${suffix}`,
      email: email('clinic'),
      slug: `live-${suffix}`,
    },
  })
  const location = await db.location.create({
    data: { clinicId: clinic.id, name: 'Main', timezone: 'UTC', phone: '555-0100' },
  })
  const discipline = await db.discipline.create({
    data: { clinicId: clinic.id, name: 'Physiotherapy' },
  })
  const service = await db.service.create({
    data: {
      clinicId: clinic.id,
      disciplineId: discipline.id,
      name: 'Consult',
      duration: 30,
      defaultPrice: new Prisma.Decimal(100),
    },
  })
  const mkUser = (role: 'SUPER_ADMIN' | 'PROVIDER' | 'PATIENT', key: string, name: string) =>
    db.user.create({
      data: {
        clinicId: clinic.id,
        name,
        email: email(key),
        password,
        role,
        hasSeenTour: true,
        hasSeenPatientTour: true,
        tourCompletedAt: done,
      },
    })
  const admin = await mkUser('SUPER_ADMIN', 'admin', 'Synthetic Admin')
  const providerUser = await mkUser('PROVIDER', 'provider', 'Synthetic Provider')
  const patient = await mkUser('PATIENT', 'patient', 'Quinn Marlowe')
  const provider = await db.provider.create({
    data: {
      clinicId: clinic.id,
      userId: providerUser.id,
      firstName: 'Synthetic',
      lastName: 'Provider',
    },
  })
  await db.providerService.create({ data: { providerId: provider.id, serviceId: service.id } })
  await db.providerLocationAssignment.create({
    data: { providerId: provider.id, locationId: location.id },
  })
  await db.patientClinicMembership.create({ data: { clinicId: clinic.id, patientId: patient.id } })

  const start = new Date()
  start.setUTCDate(start.getUTCDate() - 1)
  start.setUTCHours(9, 0, 0, 0)
  const appointment = await db.appointment.create({
    data: {
      clinicId: clinic.id,
      providerId: provider.id,
      serviceId: service.id,
      patientId: patient.id,
      locationId: location.id,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
      priceAtBooking: new Prisma.Decimal(100),
      status: 'COMPLETED',
    },
  })
  const template = await db.formTemplate.create({
    data: {
      clinicId: clinic.id,
      name: 'Synthetic intake',
      scope: 'CLINIC',
      fields: [
        { id: 'reason', type: 'text', label: 'Reason for visit', required: true },
        { id: 'age', type: 'number', label: 'Age' },
        { id: 'consent', type: 'checkbox', label: 'I consent to treatment', required: true },
      ],
    },
  })

  process.stdout.write(
    `${JSON.stringify({
      clinicId: clinic.id,
      appointmentId: appointment.id,
      templateId: template.id,
      disciplineId: discipline.id,
      patientId: patient.id,
      emails: { admin: admin.email, provider: providerUser.email, patient: patient.email },
    })}\n`
  )
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`seed failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
  .finally(() => void db.$disconnect())
