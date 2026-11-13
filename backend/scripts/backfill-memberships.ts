/**
 * Backfill PatientClinicMembership rows for every PATIENT user that has a
 * non-null `clinicId` but no membership row yet.
 *
 * Idempotent: uses upsert under the hood. Safe to run multiple times.
 *
 * Run from the backend directory:
 *   npx ts-node scripts/backfill-memberships.ts
 */

import { PrismaClient } from '@prisma/client'

async function main() {
  const prisma = new PrismaClient()

  const patients = await prisma.user.findMany({
    where: {
      role: 'PATIENT',
      clinicId: { not: null },
      isActive: true,
    },
    select: { id: true, email: true, clinicId: true },
  })

  let upserts = 0
  for (const p of patients) {
    if (!p.clinicId) continue
    await prisma.patientClinicMembership.upsert({
      where: {
        clinicId_patientId: {
          clinicId: p.clinicId,
          patientId: p.id,
        },
      },
      create: {
        clinicId: p.clinicId,
        patientId: p.id,
        isActive: true,
      },
      update: { isActive: true },
    })
    upserts++
    // eslint-disable-next-line no-console
    console.log(`✓ ${p.email} → clinic ${p.clinicId}`)
  }

  // eslint-disable-next-line no-console
  console.log(`\nDone. ${upserts} membership rows upserted across ${patients.length} patients.`)
  await prisma.$disconnect()
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
