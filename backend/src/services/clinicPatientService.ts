/**
 * Clinic staff add a patient at the desk (CTO-24): a walk-in or a phone
 * booking, with no website and no patient password needed.
 *
 *  - Find or create by email. With a phone number only, the patient gets a
 *    non-routable placeholder address (`*@patients.invalid`, RFC 2606), so
 *    nothing is ever sent to it and the real address can be added later.
 *  - The password is a random secret nobody knows; the patient sets their
 *    own through an optional invite link (24 h), which is returned so staff
 *    can copy it when e-mail isn't configured.
 *  - Joining the clinic is a PatientClinicMembership row. An existing patient
 *    of another clinic is linked, never duplicated; a staff account's email
 *    is refused.
 */
import crypto from 'crypto'
import * as argon2 from 'argon2'
import prisma from '../config/prisma'
import { withTenantBypass } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'
import * as passwordSetupService from './passwordSetupService'
import { sendPatientInviteEmail } from './emailService'
import { ensurePatientClinicMembership } from './patientMembershipService'

export const PLACEHOLDER_EMAIL_DOMAIN = 'patients.invalid'

export const isPlaceholderEmail = (email: string | null | undefined) =>
  !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)

export interface CreateClinicPatientInput {
  name: string
  email?: string | null
  phone?: string | null
  sendInvite?: boolean
}

const frontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

function httpError(statusCode: number, message: string, code: string): ApiError {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  err.code = code
  return err
}

export async function createClinicPatient(
  clinicId: string,
  input: CreateClinicPatientInput,
  performedById: string
) {
  const name = input.name.trim()
  const email = input.email?.trim().toLowerCase() || null
  const phone = input.phone?.trim() || null
  if (!email && !phone) {
    throw httpError(400, 'Enter an email or a phone number', 'validation_error')
  }

  // Users aren't clinic-scoped (one login across clinics), so the email
  // look-up is a deliberate cross-tenant read; nothing about another clinic
  // is returned.
  const existing = email
    ? await withTenantBypass('clinic-patient:find-by-email', () =>
        prisma.user.findUnique({
          where: { email },
          select: { id: true, name: true, email: true, phone: true, role: true },
        })
      )
    : null
  if (existing && existing.role !== 'PATIENT') {
    throw httpError(409, 'That email belongs to a staff account', 'conflict')
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { name: true, locations: { where: { isActive: true }, select: { id: true }, take: 1 } },
  })
  if (!clinic) throw httpError(404, 'Clinic not found', 'not_found')

  const created = !existing
  const patient =
    existing ??
    (await prisma.user.create({
      data: {
        name,
        email: email ?? `walkin+${crypto.randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`,
        phone,
        role: 'PATIENT',
        clinicId,
        password: await argon2.hash(crypto.randomBytes(32).toString('hex'), {
          type: argon2.argon2id,
        }),
      },
      select: { id: true, name: true, email: true, phone: true, role: true },
    }))

  await ensurePatientClinicMembership({
    clinicId,
    patientId: patient.id,
    // Never move an existing patient's primary location.
    primaryLocationId: created ? (clinic.locations[0]?.id ?? null) : undefined,
  })

  // An invite only makes sense for a new account with a real address.
  let inviteLink: string | null = null
  let inviteEmailed = false
  if (created && input.sendInvite !== false && !isPlaceholderEmail(patient.email)) {
    const token = await passwordSetupService.createPasswordSetupToken(patient.id)
    inviteLink = `${frontendUrl()}/set-password?token=${token}`
    try {
      await sendPatientInviteEmail({
        to: patient.email,
        name: patient.name,
        clinicName: clinic.name,
        setupLink: inviteLink,
      })
      inviteEmailed = Boolean(process.env.SMTP_HOST)
    } catch (err) {
      // Best effort: the link is still shown to staff to copy.
      console.warn('[clinicPatient] invite email failed:', (err as Error).message)
    }
  }

  await auditService.logAudit({
    clinicId,
    entityType: 'User',
    entityId: patient.id,
    action: created ? 'PATIENT_CREATED' : 'PATIENT_LINKED',
    newValue: {
      source: 'staff',
      hasEmail: !isPlaceholderEmail(patient.email),
      invite: !!inviteLink,
    },
    performedById,
  })

  return {
    patient: {
      id: patient.id,
      name: patient.name,
      email: isPlaceholderEmail(patient.email) ? null : patient.email,
      phone: patient.phone,
    },
    created,
    inviteLink,
    inviteEmailed,
  }
}
