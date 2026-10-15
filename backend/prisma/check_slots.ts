import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const providerEmail = 'provider.dev@example.com'
  console.log(`Checking data for provider: ${providerEmail}\n`)

  const providerUser = await prisma.user.findUnique({
    where: { email: providerEmail },
    include: {
      provider: {
        include: {
          providerServices: {
            include: {
              service: true,
            },
          },
          providerAvailability: true,
          providerUnavailability: true,
          locationAssignments: {
            include: { location: true },
          },
        },
      },
    },
  })

  if (!providerUser || !providerUser.provider) {
    console.log('❌ Provider not found!')
    return
  }

  const p = providerUser.provider
  console.log('✅ Provider Record Exists')
  console.log(`   ID: ${p.id}`)
  console.log(`   ClinicID: ${p.clinicId}`)
  console.log(`   IsActive: ${p.isActive}`)

  console.log('\n--- Services ---')
  if (p.providerServices.length === 0) {
    console.log('❌ No services linked to this provider!')
  } else {
    p.providerServices.forEach((ps) => {
      console.log(
        `   ✅ Service: ${ps.service.name} (${ps.service.duration} mins) - Active: ${ps.service.isActive}`
      )
    })
  }

  console.log('\n--- Availability (Working Hours) ---')
  if (p.providerAvailability.length === 0) {
    console.log('❌ No regular availability (working hours) set!')
  } else {
    p.providerAvailability.forEach((a) => {
      console.log(`   ✅ Day ${a.weekday}: ${a.startTime} - ${a.endTime}`)
    })
  }

  console.log('\n--- Location Assignments ---')
  if (p.locationAssignments.length === 0) {
    console.log('❌ No locations assigned to this provider!')
  } else {
    p.locationAssignments.forEach((la) => {
      console.log(`   ✅ Assigned to Location: ${la.location.name} - IsPrimary: ${la.isPrimary}`)
    })
  }

  console.log('\n--- All Clinic Locations ---')
  const locations = await prisma.location.findMany({
    where: { clinicId: p.clinicId },
  })
  if (locations.length === 0) {
    console.log('❌ No locations exist for this clinic overall!')
  } else {
    locations.forEach((l) => {
      console.log(`   ✅ Clinic Location: ${l.name} - Active: ${l.isActive}`)
    })
  }

  console.log('\n--- Appointment Types (Disciplines) ---')
  const disciplines = await prisma.discipline.findMany({
    where: { clinicId: p.clinicId },
  })
  if (disciplines.length === 0) {
    console.log('❌ No disciplines exist for this clinic! Providers usually need a discipline.')
  } else {
    disciplines.forEach((d) => {
      console.log(`   ✅ Discipline: ${d.name} - Active: ${d.isActive}`)
    })
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
