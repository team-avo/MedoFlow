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
import { seedBookingWorld, seedCatalogue } from './demoWorld'

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
  await seedCatalogue(prisma, clinic.id)

  // 5) Booking prerequisites — location, discipline, services, providers,
  //    availability windows so the in-nav Book Appointment modal has real
  //    data to render against.
  await seedBookingWorld(prisma, clinic.id)

  print(tenant.name, clinic.name)
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
