import { google } from 'googleapis'
import crypto from 'crypto'
import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import * as aiScribeService from './aiScribeService'
import * as visitService from './visitService'

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
]
const TOKEN_PREFIX = 'enc:v1:'

const getTokenEncryptionKey = (): Buffer | null => {
  const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  if (!key) return null
  const trimmed = key.trim()
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed)
  if (!isHex || trimmed.length !== 64) {
    const err = new Error(
      'GOOGLE_TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)'
    ) as ApiError
    err.statusCode = 500
    throw err
  }
  return Buffer.from(trimmed, 'hex')
}

const encryptToken = (value: string | null | undefined): string | null => {
  if (!value) return null
  const key = getTokenEncryptionKey()
  if (!key) return value
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${TOKEN_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

const decryptToken = (value: string | null | undefined): string | null => {
  if (!value) return null
  if (!value.startsWith(TOKEN_PREFIX)) return value
  const key = getTokenEncryptionKey()
  if (!key) return value
  const parts = value.replace(TOKEN_PREFIX, '').split(':')
  if (parts.length !== 3) return value
  const [ivB64, tagB64, encB64] = parts as [string, string, string]
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

const getOAuthClient = (redirectUri: string) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    const err = new Error(
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
    ) as ApiError
    err.statusCode = 500
    throw err
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export const getGoogleAuthUrl = (redirectUri: string, userId: string, clinicId: string) => {
  const oauth2Client = getOAuthClient(redirectUri)
  const state = Buffer.from(JSON.stringify({ userId, clinicId })).toString('base64')
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  })
  return { authUrl }
}

export const connectGoogleCalendar = async (
  userId: string,
  clinicId: string,
  code: string,
  redirectUri: string
) => {
  const oauth2Client = getOAuthClient(redirectUri)
  const tokenResponse = await oauth2Client.getToken(code)
  const tokens = tokenResponse.tokens
  if (!tokens.access_token) {
    const err = new Error('Google OAuth did not return an access token') as ApiError
    err.statusCode = 400
    throw err
  }

  oauth2Client.setCredentials(tokens)
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
  const profile = await oauth2.userinfo.get()
  const email = profile.data.email
  if (!email) {
    const err = new Error('Unable to read Google account email') as ApiError
    err.statusCode = 400
    throw err
  }

  const connection = await prisma.googleCalendarConnection.upsert({
    where: { userId_clinicId: { userId, clinicId } },
    create: {
      userId,
      clinicId,
      email,
      accessToken: encryptToken(tokens.access_token)!,
      refreshToken: encryptToken(tokens.refresh_token ?? null),
      tokenType: tokens.token_type ?? null,
      scope: tokens.scope ?? null,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    update: {
      email,
      accessToken: encryptToken(tokens.access_token)!,
      refreshToken:
        tokens.refresh_token !== undefined ? encryptToken(tokens.refresh_token) : undefined,
      tokenType: tokens.token_type ?? null,
      scope: tokens.scope ?? null,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  })

  return connection
}

const getConnectionForUser = async (userId: string, clinicId: string) => {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { userId_clinicId: { userId, clinicId } },
  })
  if (!connection) {
    const err = new Error('Google Calendar is not connected for this account') as ApiError
    err.statusCode = 404
    throw err
  }
  return connection
}

const createAuthedCalendarClient = async (
  connection: {
    id: string
    clinicId: string
    accessToken: string
    refreshToken: string | null
    expiryDate: Date | null
  },
  redirectUri: string
) => {
  const oauth2Client = getOAuthClient(redirectUri)
  const accessToken = decryptToken(connection.accessToken)
  const refreshToken = decryptToken(connection.refreshToken)
  oauth2Client.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken ?? undefined,
    expiry_date: connection.expiryDate?.getTime(),
  })
  const expiry = connection.expiryDate?.getTime() ?? 0
  const shouldRefresh = Boolean(refreshToken) && expiry > 0 && expiry < Date.now() + 60_000
  if (shouldRefresh) {
    await oauth2Client.getAccessToken()
    const creds = oauth2Client.credentials
    if (creds.access_token) {
      await prisma.googleCalendarConnection.update({
        where: { id: connection.id, clinicId: connection.clinicId },
        data: {
          accessToken: encryptToken(creds.access_token)!,
          refreshToken:
            creds.refresh_token !== undefined ? encryptToken(creds.refresh_token) : undefined,
          tokenType: creds.token_type ?? null,
          scope: creds.scope ?? null,
          expiryDate: creds.expiry_date ? new Date(creds.expiry_date) : null,
        },
      })
    }
  }
  return google.calendar({ version: 'v3', auth: oauth2Client })
}

export const syncUpcomingMeetEvents = async (
  userId: string,
  clinicId: string,
  redirectUri: string,
  days = 7
) => {
  const connection = await getConnectionForUser(userId, clinicId)
  const provider = await visitService.getProviderByUserId(userId)
  const calendar = await createAuthedCalendarClient(connection, redirectUri)
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + Math.max(1, Math.min(days, 30)))

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  const items = response.data.items ?? []
  const synced: string[] = []
  for (const event of items) {
    const googleEventId = event.id
    const startDateTime = event.start?.dateTime
    const endDateTime = event.end?.dateTime
    if (!googleEventId || !startDateTime || !endDateTime) continue
    const meetLink =
      event.hangoutLink ||
      event.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ||
      null
    if (!meetLink?.includes('meet.google.com')) continue

    const startTime = new Date(startDateTime)
    const endTime = new Date(endDateTime)

    let appointmentId: string | null = null
    if (provider) {
      const matched = await prisma.appointment.findFirst({
        where: {
          clinicId,
          providerId: provider.id,
          startTime: {
            gte: new Date(startTime.getTime() - 30 * 60 * 1000),
            lte: new Date(startTime.getTime() + 30 * 60 * 1000),
          },
          status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
        },
        select: { id: true },
      })
      appointmentId = matched?.id ?? null
    }

    await prisma.googleCalendarEvent.upsert({
      where: {
        connectionId_googleEventId: {
          connectionId: connection.id,
          googleEventId,
        },
        clinicId,
      },
      create: {
        connectionId: connection.id,
        clinicId,
        providerId: provider?.id ?? null,
        googleEventId,
        summary: event.summary ?? null,
        startTime,
        endTime,
        meetLink,
        status: event.status ?? 'confirmed',
        appointmentId,
      },
      update: {
        summary: event.summary ?? null,
        startTime,
        endTime,
        meetLink,
        status: event.status ?? 'confirmed',
        appointmentId,
      },
    })
    synced.push(googleEventId)
  }

  return { syncedCount: synced.length }
}

export const listMeetEvents = async (userId: string, clinicId: string) => {
  const connection = await getConnectionForUser(userId, clinicId)
  return prisma.googleCalendarEvent.findMany({
    where: {
      connectionId: connection.id,
      clinicId,
      startTime: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      status: { not: 'cancelled' },
    },
    orderBy: { startTime: 'asc' },
    take: 50,
  })
}

export const getConnectionStatus = async (userId: string, clinicId: string) => {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { userId_clinicId: { userId, clinicId } },
    select: {
      id: true,
      email: true,
      expiryDate: true,
      updatedAt: true,
    },
  })
  if (!connection) return { connected: false as const }
  const lastEvent = await prisma.googleCalendarEvent.findFirst({
    where: { connectionId: connection.id, clinicId },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })
  return {
    connected: true as const,
    email: connection.email,
    tokenExpiry: connection.expiryDate,
    lastSyncedAt: lastEvent?.updatedAt ?? null,
  }
}

export const disconnectGoogleCalendar = async (userId: string, clinicId: string) => {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { userId_clinicId: { userId, clinicId } },
    select: { id: true },
  })
  if (!connection) return { disconnected: false }
  await prisma.googleCalendarConnection.delete({ where: { id: connection.id, clinicId } })
  return { disconnected: true }
}

const resolveEventAppointment = async (event: {
  clinicId: string
  providerId: string | null
  appointmentId: string | null
  startTime: Date
}) => {
  if (event.appointmentId) return event.appointmentId
  if (!event.providerId) return null
  const candidate = await prisma.appointment.findFirst({
    where: {
      clinicId: event.clinicId,
      providerId: event.providerId,
      startTime: {
        gte: new Date(event.startTime.getTime() - 30 * 60 * 1000),
        lte: new Date(event.startTime.getTime() + 30 * 60 * 1000),
      },
      status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
    },
    select: { id: true },
  })
  return candidate?.id ?? null
}

export const listAppointmentCandidatesForEvent = async (
  userId: string,
  clinicId: string,
  eventId: string
) => {
  const provider = await visitService.getProviderByUserId(userId)
  if (!provider) {
    const err = new Error('Provider profile not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const event = await prisma.googleCalendarEvent.findFirst({
    where: { id: eventId, clinicId, providerId: provider.id },
    select: { startTime: true, endTime: true },
  })
  if (!event) {
    const err = new Error('Meeting event not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return prisma.appointment.findMany({
    where: {
      clinicId,
      providerId: provider.id,
      startTime: {
        gte: new Date(event.startTime.getTime() - 6 * 60 * 60 * 1000),
        lte: new Date(event.endTime.getTime() + 6 * 60 * 60 * 1000),
      },
      status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
    },
    include: {
      patient: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
    orderBy: { startTime: 'asc' },
    take: 50,
  })
}

export const linkEventToAppointment = async (
  userId: string,
  clinicId: string,
  eventId: string,
  appointmentId: string
) => {
  const provider = await visitService.getProviderByUserId(userId)
  if (!provider) {
    const err = new Error('Provider profile not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      clinicId,
      providerId: provider.id,
      status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
    },
    select: { id: true },
  })
  if (!appointment) {
    const err = new Error('Appointment not found for this provider') as ApiError
    err.statusCode = 404
    throw err
  }
  return prisma.googleCalendarEvent.update({
    where: { id: eventId, clinicId },
    data: { appointmentId: appointment.id },
  })
}

export const startScribeFromMeeting = async (userId: string, clinicId: string, eventId: string) => {
  const provider = await visitService.getProviderByUserId(userId)
  if (!provider) {
    const err = new Error('Provider profile not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const event = await prisma.googleCalendarEvent.findFirst({
    where: {
      id: eventId,
      clinicId,
      providerId: provider.id,
    },
  })
  if (!event) {
    const err = new Error('Meeting event not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (!event.meetLink) {
    const err = new Error('Meeting does not have a Google Meet link') as ApiError
    err.statusCode = 400
    throw err
  }
  const appointmentId = await resolveEventAppointment(event)
  if (!appointmentId) {
    const err = new Error(
      'No appointment mapped to this meeting. Sync events or create appointment first.'
    ) as ApiError
    err.statusCode = 400
    throw err
  }

  if (!event.appointmentId) {
    await prisma.googleCalendarEvent.update({
      where: { id: event.id, clinicId: event.clinicId },
      data: { appointmentId },
    })
  }

  const existingVisitRecord = await visitService.getVisitRecordByAppointment(
    appointmentId,
    clinicId
  )
  const visitRecord = existingVisitRecord
    ? existingVisitRecord
    : await visitService.createVisitRecord({ appointmentId }, provider.id, clinicId, userId)
  if (!visitRecord) {
    const err = new Error('Failed to create visit record for this meeting') as ApiError
    err.statusCode = 500
    throw err
  }

  const existingSession = await aiScribeService.getSessionByVisitRecordId(
    visitRecord.id,
    provider.id,
    clinicId
  )
  if (existingSession && existingSession.status !== 'APPROVED') {
    return { session: existingSession, visitRecord }
  }

  const session = await aiScribeService.createSession(visitRecord.id, provider.id, clinicId)
  return { session, visitRecord }
}
