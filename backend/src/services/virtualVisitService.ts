/**
 * Video visits (CTO-31). When a VIRTUAL appointment is confirmed (booked with
 * nothing to pay, or paid), the consultation session, its 8x8 JaaS room and
 * the patient's join link are created straight away, and the link goes out
 * with the confirmation. The provider enters with one click from the
 * appointment; the room is reused (consultationController.createVideoRoom
 * keeps a room that belongs to this JaaS app).
 *
 * Video stays behind VIDEO_PHI_POLICY (jaasService): without JaaS configured
 * the session and link are still created, and the call starts once video is
 * set up. Best effort throughout: a failure never undoes the booking.
 */
import prisma from '../config/prisma'
import * as auditService from './auditService'
import * as jaasService from './jaasService'
import { generateJoinToken, getJoinTokenExpiry } from './consultationService'
import { sendAppointmentConfirmation } from './emailService'

const frontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

export const joinUrlFor = (joinToken: string) => `${frontendUrl()}/consultation/${joinToken}`

/** Creates (or reuses) the session and room for a confirmed video visit; returns the join URL. */
export async function prepareVirtualVisit(appointmentId: string, clinicId: string) {
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    select: {
      id: true,
      mode: true,
      status: true,
      providerId: true,
      patientId: true,
      aiScribeConsentGrantedAt: true,
    },
  })
  if (!appt || appt.mode !== 'VIRTUAL' || appt.status !== 'CONFIRMED') return null

  let session = await prisma.consultationSession.findFirst({
    where: { appointmentId, clinicId, status: { not: 'FAILED' } },
  })
  if (!session) {
    session = await prisma.consultationSession.create({
      data: {
        clinicId,
        appointmentId,
        providerId: appt.providerId,
        patientId: appt.patientId,
        status: 'READY',
        joinToken: generateJoinToken(),
        joinTokenExpiresAt: getJoinTokenExpiry(),
        consentStatus: appt.aiScribeConsentGrantedAt ? 'GRANTED' : 'PENDING',
        consentGrantedAt: appt.aiScribeConsentGrantedAt,
      },
    })
    await auditService.logAudit({
      clinicId,
      entityType: 'ConsultationSession',
      entityId: session.id,
      action: 'CONSULTATION_SESSION_CREATED',
      newValue: { source: 'virtual_booking' },
      performedById: null,
    })
  }

  if (jaasService.isJaasEnabled() && !jaasService.isOwnRoom(session.meetingRoomName)) {
    const roomName = jaasService.generateRoomName(`MedoFlow-${session.id.slice(0, 10)}`)
    await prisma.consultationSession.update({
      where: { id: session.id, clinicId },
      data: {
        meetingRoomName: roomName,
        meetingRoomUrl: `https://${jaasService.JAAS_DOMAIN}/${roomName}`,
      },
    })
    await auditService.logAudit({
      clinicId,
      entityType: 'ConsultationSession',
      entityId: session.id,
      action: 'VIDEO_ROOM_CREATED',
      newValue: { source: 'virtual_booking' },
      performedById: null,
    })
  }
  return { sessionId: session.id, joinUrl: joinUrlFor(session.joinToken) }
}

/** Confirmation e-mail for a video visit, with the join link. Best effort. */
export async function confirmVirtualVisit(appointmentId: string, clinicId: string) {
  try {
    const prepared = await prepareVirtualVisit(appointmentId, clinicId)
    if (!prepared) return null
    const appt = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      include: {
        patient: { select: { name: true, email: true } },
        service: { select: { name: true } },
        provider: { select: { firstName: true, lastName: true } },
      },
    })
    if (appt?.patient.email && !appt.patient.email.endsWith('@patients.invalid')) {
      await sendAppointmentConfirmation({
        to: appt.patient.email,
        patientName: appt.patient.name,
        appointmentDate: appt.startTime.toLocaleString('en-US', { timeZone: appt.timezone }),
        serviceName: appt.service.name,
        providerName: `${appt.provider.firstName} ${appt.provider.lastName}`,
        locationName: 'Video visit',
        joinUrl: prepared.joinUrl,
      })
    }
    return prepared
  } catch (err) {
    console.warn('[virtualVisit] confirmation not sent:', (err as Error).message)
    return null
  }
}
