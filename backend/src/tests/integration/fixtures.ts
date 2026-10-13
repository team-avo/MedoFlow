/**
 * Synthetic two-tenant fixture for the integration suites. Every value is
 * fake (example.test emails, 555-01xx phones). Each call creates a fresh,
 * uniquely-suffixed tenant so suites never depend on each other's data.
 */
import crypto from 'crypto'
import * as argon2 from 'argon2'
import { Prisma } from '@prisma/client'
import { adminDb, FIXTURE_PASSWORD } from './helpers'

let passwordHash: string | null = null
const hashPassword = async () =>
  (passwordHash ??= await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id }))

export interface ClinicFixture {
  label: string
  tenantId: string
  clinicId: string
  locationId: string
  serviceId: string
  providerId: string
  users: { admin: FixtureUser; provider: FixtureUser; frontDesk: FixtureUser; patient: FixtureUser }
  appointmentId: string
  invoiceId: string
  visitRecordId: string
  patientFileId: string
}

export interface FixtureUser {
  id: string
  email: string
}

const day = (offsetDays: number, hourUtc: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  d.setUTCHours(hourUtc, 0, 0, 0)
  return d
}

export async function createClinicFixture(label: string): Promise<ClinicFixture> {
  const suffix = `${label}-${crypto.randomBytes(4).toString('hex')}`.toLowerCase()
  const email = (role: string) => `${role}.${suffix}@example.test`
  const password = await hashPassword()

  const tenant = await adminDb.tenant.create({
    data: { name: `Synthetic ${suffix}`, slug: `t-${suffix}` },
  })
  const clinic = await adminDb.clinic.create({
    data: {
      tenantId: tenant.id,
      name: `Clinic ${suffix}`,
      email: email('clinic'),
      slug: `c-${suffix}`,
    },
  })
  const location = await adminDb.location.create({
    data: { clinicId: clinic.id, name: 'Main', timezone: 'UTC', phone: '555-0100' },
  })
  const discipline = await adminDb.discipline.create({
    data: { clinicId: clinic.id, name: 'General' },
  })
  const service = await adminDb.service.create({
    data: {
      clinicId: clinic.id,
      disciplineId: discipline.id,
      name: 'Consult',
      duration: 30,
      defaultPrice: new Prisma.Decimal(100),
    },
  })

  const mkUser = async (
    role: 'SUPER_ADMIN' | 'PROVIDER' | 'FRONT_DESK' | 'PATIENT',
    key: string
  ) => {
    const u = await adminDb.user.create({
      data: { clinicId: clinic.id, name: `${key} ${suffix}`, email: email(key), password, role },
    })
    return { id: u.id, email: u.email }
  }
  const admin = await mkUser('SUPER_ADMIN', 'admin')
  const providerUser = await mkUser('PROVIDER', 'provider')
  const frontDesk = await mkUser('FRONT_DESK', 'frontdesk')
  const patient = await mkUser('PATIENT', 'patient')

  const provider = await adminDb.provider.create({
    data: {
      clinicId: clinic.id,
      userId: providerUser.id,
      firstName: 'Pat',
      lastName: `Provider ${suffix}`,
    },
  })
  await adminDb.providerService.create({ data: { providerId: provider.id, serviceId: service.id } })
  await adminDb.providerLocationAssignment.create({
    data: { providerId: provider.id, locationId: location.id },
  })
  for (let weekday = 0; weekday < 7; weekday++) {
    await adminDb.providerAvailability.create({
      data: {
        providerId: provider.id,
        locationId: location.id,
        weekday,
        startTime: '00:00',
        endTime: '23:59',
      },
    })
  }
  await adminDb.patientClinicMembership.create({
    data: { clinicId: clinic.id, patientId: patient.id },
  })

  const appointment = await adminDb.appointment.create({
    data: {
      clinicId: clinic.id,
      providerId: provider.id,
      serviceId: service.id,
      patientId: patient.id,
      locationId: location.id,
      startTime: day(3, 9),
      endTime: new Date(day(3, 9).getTime() + 30 * 60_000),
      priceAtBooking: new Prisma.Decimal(100),
      status: 'CONFIRMED',
    },
  })
  const visit = await adminDb.visitRecord.create({
    data: {
      clinicId: clinic.id,
      appointmentId: appointment.id,
      providerId: provider.id,
      patientId: patient.id,
      subjective: 'Synthetic note: no real patient data.',
    },
  })
  const invoice = await adminDb.invoice.create({
    data: {
      clinicId: clinic.id,
      patientId: patient.id,
      appointmentId: appointment.id,
      subtotal: new Prisma.Decimal(100),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(100),
    },
  })
  const file = await adminDb.patientFile.create({
    data: {
      clinicId: clinic.id,
      patientId: patient.id,
      uploadedById: admin.id,
      originalName: 'synthetic.pdf',
      storagePath: `synthetic/${suffix}.pdf`,
      mimeType: 'application/pdf',
      size: 10,
    },
  })

  return {
    label,
    tenantId: tenant.id,
    clinicId: clinic.id,
    locationId: location.id,
    serviceId: service.id,
    providerId: provider.id,
    users: { admin, provider: providerUser, frontDesk, patient },
    appointmentId: appointment.id,
    invoiceId: invoice.id,
    visitRecordId: visit.id,
    patientFileId: file.id,
  }
}

/** A slot n days ahead at a given UTC hour, as ISO strings. */
export const slot = (offsetDays: number, hourUtc: number, minutes = 30) => {
  const start = day(offsetDays, hourUtc)
  return {
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + minutes * 60_000).toISOString(),
  }
}
