import prisma from '../config/prisma'
import { ApiError } from '../types/errors'
import { clinicScope } from '../config/tenantContext'

export interface ProviderProfileUpdate {
  bio?: string | null
  headshotUrl?: string | null
  signatureUrl?: string | null
  licenseNumber?: string | null
  languages?: string[]
  phone?: string | null
  scribeTemplateId?: string | null
  scribeTone?: 'CONCISE' | 'DETAILED'
  scribeIncludeCoding?: boolean
}

async function getProviderForUser(userId: string) {
  const provider = await prisma.provider.findFirst({
    where: { userId, ...clinicScope() },
    select: {
      id: true,
      clinicId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      bio: true,
      headshotUrl: true,
      signatureUrl: true,
      licenseNumber: true,
      languages: true,
      scribeTemplateId: true,
      scribeTone: true,
      scribeIncludeCoding: true,
      isActive: true,
      scribeTemplate: {
        select: { id: true, name: true, specialty: true, description: true },
      },
    },
  })
  if (!provider) {
    const err = new Error('You do not have a provider record on this clinic') as ApiError
    err.statusCode = 404
    throw err
  }
  return provider
}

export async function getMyProfile(userId: string) {
  return getProviderForUser(userId)
}

export async function updateMyProfile(userId: string, input: ProviderProfileUpdate) {
  const provider = await getProviderForUser(userId)

  // If a scribeTemplateId is passed, ensure it's valid (system default OR
  // belongs to the provider's clinic).
  if (input.scribeTemplateId) {
    const template = await prisma.scribeTemplate.findFirst({
      where: {
        id: input.scribeTemplateId,
        isActive: true,
        OR: [{ clinicId: null }, { clinicId: provider.clinicId }],
      },
      select: { id: true },
    })
    if (!template) {
      const err = new Error('Scribe template not available for this clinic') as ApiError
      err.statusCode = 400
      throw err
    }
  }

  const updated = await prisma.provider.update({
    where: { id: provider.id, clinicId: provider.clinicId },
    data: {
      bio: input.bio === undefined ? undefined : input.bio,
      headshotUrl: input.headshotUrl === undefined ? undefined : input.headshotUrl,
      signatureUrl: input.signatureUrl === undefined ? undefined : input.signatureUrl,
      licenseNumber: input.licenseNumber === undefined ? undefined : input.licenseNumber,
      languages: input.languages,
      phone: input.phone === undefined ? undefined : input.phone,
      scribeTemplateId: input.scribeTemplateId === undefined ? undefined : input.scribeTemplateId,
      scribeTone: input.scribeTone,
      scribeIncludeCoding: input.scribeIncludeCoding,
    },
    select: {
      id: true,
      bio: true,
      headshotUrl: true,
      signatureUrl: true,
      licenseNumber: true,
      languages: true,
      phone: true,
      scribeTemplateId: true,
      scribeTone: true,
      scribeIncludeCoding: true,
      scribeTemplate: {
        select: { id: true, name: true, specialty: true, description: true },
      },
    },
  })
  return updated
}

export async function listAvailableTemplates(userId: string) {
  const provider = await prisma.provider.findFirst({
    where: { userId, ...clinicScope() },
    select: { clinicId: true },
  })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return prisma.scribeTemplate.findMany({
    where: {
      isActive: true,
      OR: [{ clinicId: null }, { clinicId: provider.clinicId }],
    },
    orderBy: [{ clinicId: 'asc' }, { specialty: 'asc' }],
    select: {
      id: true,
      name: true,
      specialty: true,
      description: true,
      isDefault: true,
      clinicId: true,
    },
  })
}
