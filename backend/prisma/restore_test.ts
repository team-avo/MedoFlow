import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function restoreTestUsers() {
  console.log('Restoring provider and patient...')

  const passwordHash = await bcrypt.hash('password', 10)

  // Get clinic
  const clinic = await prisma.clinic.findFirst()
  const clinicId = clinic?.id

  if (!clinicId) {
    console.error('No clinic found')
    process.exit(1)
  }

  // 1. Create Provider
  const providerUser = await prisma.user.upsert({
    where: { email: 'provider@medoflow.com' },
    update: { password: passwordHash, email: 'provider.dev@example.com' },
    create: {
      email: 'provider.dev@example.com',
      password: passwordHash,
      name: 'Dr. Abhinav Verma',
      role: 'PROVIDER',
      clinicId: clinicId!,
      isActive: true,
    },
  })

  const providerProfile = await prisma.provider.upsert({
    where: { userId: providerUser.id },
    update: {},
    create: {
      userId: providerUser.id,
      clinicId: clinicId!,
      firstName: 'Abhinav',
      lastName: 'Verma',
      isActive: true,
    },
  })

  // Assign Service to Provider
  const service = await prisma.service.findFirst({ where: { clinicId } })
  if (service) {
    await prisma.providerService.upsert({
      where: {
        providerId_serviceId: { providerId: providerProfile.id, serviceId: service.id },
      },
      update: {},
      create: { providerId: providerProfile.id, serviceId: service.id },
    })
  }

  const location = await prisma.location.findFirst({ where: { clinicId } })
  if (location) {
    await prisma.providerLocationAssignment.upsert({
      where: { providerId_locationId: { providerId: providerProfile.id, locationId: location.id } },
      update: {},
      create: { providerId: providerProfile.id, locationId: location.id },
    })
  }

  // 2. Create Patient
  const patientUser = await prisma.user.upsert({
    where: { email: 'patient.dev@example.com' },
    update: { password: passwordHash },
    create: {
      email: 'patient.dev@example.com',
      password: passwordHash,
      name: 'Patient Abhi',
      role: 'PATIENT',
      clinicId: clinicId!,
      isActive: true,
    },
  })

  // 3. Create a pending appointment for right now so they have something to click
  if (service && location) {
    const startTime = new Date()
    const endTime = new Date(startTime.getTime() + 30 * 60000) // +30 mins

    const appt = await prisma.appointment.create({
      data: {
        clinicId: clinicId!,
        providerId: providerProfile.id,
        patientId: patientUser.id,
        serviceId: service.id,
        locationId: location.id,
        startTime,
        endTime,
        status: 'CONFIRMED',
        timezone: 'Asia/Kolkata',
        meetLink: 'https://meet.google.com/test-medo-flow',
        priceAtBooking: 100,
        paymentStatus: 'NONE',
        paymentRequirementType: 'NONE',
      },
    })
    console.log(`Created test appointment: ${appt.id}`)
  }

  console.log('Restoration complete!')
  console.log('Provider: provider.dev@example.com / password')
  console.log('Patient: patient.dev@example.com / password')
}

restoreTestUsers()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
