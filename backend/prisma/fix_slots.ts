import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const providerEmail = 'provider.dev@example.com'
  console.log(`Fixing relations for provider: ${providerEmail}\n`)

  const providerUser = await prisma.user.findUnique({
    where: { email: providerEmail },
    include: { provider: true },
  })

  if (!providerUser || !providerUser.provider) {
    console.log('❌ Provider not found!')
    return
  }

  const p = providerUser.provider
  const clinicId = p.clinicId

  // 1. Assign to Location
  const location = await prisma.location.findFirst({ where: { clinicId } })
  if (location) {
    const existingLA = await prisma.providerLocationAssignment.findUnique({
      where: { providerId_locationId: { providerId: p.id, locationId: location.id } },
    })
    if (!existingLA) {
      await prisma.providerLocationAssignment.create({
        data: {
          providerId: p.id,
          locationId: location.id,
          isPrimary: true,
        },
      })
      console.log(`✅ Assigned provider to location: ${location.name}`)
    } else {
      console.log(`ℹ️ Provider already assigned to location: ${location.name}`)
    }
  }

  // 2. Assign to Discipline
  const discipline = await prisma.discipline.findFirst({ where: { clinicId } })
  if (discipline) {
    const existingPD = await prisma.providerDiscipline.findUnique({
      where: { providerId_disciplineId: { providerId: p.id, disciplineId: discipline.id } },
    })
    if (!existingPD) {
      await prisma.providerDiscipline.create({
        data: {
          providerId: p.id,
          disciplineId: discipline.id,
        },
      })
      console.log(`✅ Assigned provider to discipline: ${discipline.name}`)
    } else {
      console.log(`ℹ️ Provider already assigned to discipline: ${discipline.name}`)
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
