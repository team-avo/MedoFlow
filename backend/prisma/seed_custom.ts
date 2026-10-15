import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('password', 12)

  // 1. Create a Clinic
  let clinic = await prisma.clinic.findFirst({
    where: { name: 'MedoFlow Clinic' },
  })
  if (!clinic) {
    clinic = await prisma.clinic.create({
      data: {
        name: 'MedoFlow Clinic',
        email: 'admin@medoflow.com',
      },
    })
    console.log('Clinic created.')
  }

  // 2. Create Clinic Admin
  const adminEmail = 'clinicadmin.dev@example.com'
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        name: 'Clinic Admin',
        email: adminEmail,
        password: passwordHash,
        role: 'SUPER_ADMIN',
        clinicId: clinic.id,
      },
    })
    console.log('Clinic Admin created: ' + adminEmail)
  }

  // 3. Create Provider
  const providerEmail = 'provider.dev@example.com'
  let providerUser = await prisma.user.findUnique({ where: { email: providerEmail } })
  if (!providerUser) {
    providerUser = await prisma.user.create({
      data: {
        name: 'Dr. Abhinav Verma',
        email: providerEmail,
        password: passwordHash,
        role: 'PROVIDER',
        clinicId: clinic.id,
      },
    })

    await prisma.provider.create({
      data: {
        clinicId: clinic.id,
        userId: providerUser.id,
        firstName: 'Abhinav',
        lastName: 'Verma',
        email: providerEmail,
        isActive: true,
      },
    })
    console.log('Provider created: ' + providerEmail)
  }

  // 4. Create Patient
  const patientEmail = 'patient.dev@example.com'
  let patientUser = await prisma.user.findUnique({ where: { email: patientEmail } })
  if (!patientUser) {
    patientUser = await prisma.user.create({
      data: {
        name: 'Abhi Patient',
        email: patientEmail,
        password: passwordHash,
        role: 'PATIENT',
        clinicId: clinic.id, // For basic patient access
      },
    })

    await prisma.patientClinicMembership.create({
      data: {
        clinicId: clinic.id,
        patientId: patientUser.id,
        isActive: true,
      },
    })
    console.log('Patient created: ' + patientEmail)
  }

  console.log('\n--- Seed Complete ---')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
