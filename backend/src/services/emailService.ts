import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
})

const FROM = process.env.SMTP_FROM || 'noreply@medoflow.com'

async function sendEmail(params: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<void> {
  const { to, subject, html, text } = params

  if (!process.env.SMTP_HOST) {
    const isExplicitDev = process.env.NODE_ENV !== 'production'
    if (!isExplicitDev) {
      throw new Error('SMTP is not configured. Refusing to send email outside development.')
    }
    // Recipient intentionally not logged (PII).
    console.warn(`[Email] SMTP not configured. Skipping send: ${subject}`)
    return
  }

  await transporter.sendMail({
    from: FROM,
    to,
    subject,
    text,
    html,
  })
}

export async function sendAppointmentConfirmation(params: {
  to: string
  patientName: string
  appointmentDate: string
  serviceName: string
  providerName: string
  locationName: string
  /** CTO-31: a video visit's join link. */
  joinUrl?: string | null
}): Promise<void> {
  const { to, patientName, appointmentDate, serviceName, providerName, locationName } = params
  const joinHtml = params.joinUrl
    ? `<p><strong>Join your video visit:</strong> <a href="${params.joinUrl}">${params.joinUrl}</a></p>`
    : ''
  const joinText = params.joinUrl ? `\nJoin your video visit: ${params.joinUrl}` : ''
  const subject = `Confirmed: Your appointment on ${appointmentDate}`
  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
      <h2>Appointment Confirmed</h2>
      <p>Hi ${patientName},</p>
      <p>Your appointment has been successfully booked and confirmed.</p>
      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Service:</strong> ${serviceName}</p>
        <p><strong>Provider:</strong> ${providerName}</p>
        <p><strong>Date & Time:</strong> ${appointmentDate}</p>
        <p><strong>Location:</strong> ${locationName}</p>
        ${joinHtml}
      </div>
      <p>We look forward to seeing you!</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #777;">If you need to reschedule or cancel, please visit your patient portal.</p>
    </div>
  `
  const text = `
Appointment Confirmed
Hi ${patientName},
Your appointment for ${serviceName} with ${providerName} on ${appointmentDate} at ${locationName} is confirmed.${joinText}
  `.trim()

  await sendEmail({ to, subject, html, text })
}

export async function sendAppointmentCancellation(params: {
  to: string
  patientName: string
  appointmentDate: string
  serviceName: string
  reason?: string
}): Promise<void> {
  const { to, patientName, appointmentDate, serviceName, reason } = params
  const subject = `Cancelled: Your appointment on ${appointmentDate}`
  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
      <h2>Appointment Cancelled</h2>
      <p>Hi ${patientName},</p>
      <p>Your appointment for <strong>${serviceName}</strong> on <strong>${appointmentDate}</strong> has been cancelled.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>If you'd like to rebook, please visit our booking page.</p>
    </div>
  `
  const text = `
Appointment Cancelled
Hi ${patientName},
Your appointment for ${serviceName} on ${appointmentDate} has been cancelled.
${reason ? `Reason: ${reason}` : ''}
  `.trim()

  await sendEmail({ to, subject, html, text })
}

export async function sendInvoiceEmail(params: {
  to: string
  patientName: string
  totalAmount: string
  invoiceUrl: string
}): Promise<void> {
  const { to, patientName, totalAmount, invoiceUrl } = params
  const subject = `Your invoice from Medoflow - ${totalAmount}`
  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
      <h2>New Invoice</h2>
      <p>Hi ${patientName},</p>
      <p>A new invoice for <strong>${totalAmount}</strong> has been generated for your recent visit/purchase.</p>
      <p><a href="${invoiceUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View & Pay Invoice</a></p>
      <p>If you have already paid, please keep this for your records.</p>
    </div>
  `
  const text = `
New Invoice
Hi ${patientName},
A new invoice for ${totalAmount} has been generated. View it here: ${invoiceUrl}
  `.trim()

  await sendEmail({ to, subject, html, text })
}

export async function sendWaitlistOffer(params: {
  to: string
  patientName: string
  appointmentDate: string
  serviceName: string
  bookingUrl: string
}): Promise<void> {
  const { to, patientName, appointmentDate, serviceName, bookingUrl } = params
  const subject = `Available: A slot for ${serviceName} has opened up!`
  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
      <h2>Good news!</h2>
      <p>Hi ${patientName},</p>
      <p>A slot has become available for <strong>${serviceName}</strong> on <strong>${appointmentDate}</strong>.</p>
      <p>As you are on our waitlist, you have 30 minutes to claim this slot before it's offered to the next person.</p>
      <p><a href="${bookingUrl}" style="background: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Claim This Slot Now</a></p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #777;">If you're no longer interested, you can safely ignore this email.</p>
    </div>
  `
  const text = `
Good news!
Hi ${patientName},
A slot has become available for ${serviceName} on ${appointmentDate}.
Claim it here within 30 minutes: ${bookingUrl}
  `.trim()

  await sendEmail({ to, subject, html, text })
}

export async function sendAppointmentReminder(params: {
  to: string
  patientName: string
  appointmentDate: string
  serviceName: string
  providerName: string
  locationName: string
}): Promise<void> {
  const { to, patientName, appointmentDate, serviceName, providerName, locationName } = params
  const subject = `Reminder: Your appointment tomorrow at ${appointmentDate}`
  const html = `
    <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
      <h2>Appointment Reminder</h2>
      <p>Hi ${patientName},</p>
      <p>This is a friendly reminder of your upcoming appointment tomorrow.</p>
      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Service:</strong> ${serviceName}</p>
        <p><strong>Provider:</strong> ${providerName}</p>
        <p><strong>Date & Time:</strong> ${appointmentDate}</p>
        <p><strong>Location:</strong> ${locationName}</p>
      </div>
      <p>We look forward to seeing you!</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #777;">If you need to reschedule or cancel, please visit your patient portal at least 24 hours in advance.</p>
    </div>
  `
  const text = `
Appointment Reminder
Hi ${patientName},
This is a reminder for your appointment tomorrow for ${serviceName} with ${providerName} on ${appointmentDate} at ${locationName}.
  `.trim()

  await sendEmail({ to, subject, html, text })
}

export async function sendProviderInviteEmail(
  to: string,
  name: string,
  setupLink: string
): Promise<void> {
  await sendStaffInviteEmail({
    to,
    name,
    setupLink,
    roleLabel: 'Provider',
  })
}

export async function sendClinicAgreementConfirmation(params: {
  to: string
  clinicName: string
  acceptedByName: string
  acceptedAt: Date
  termsVersion: string
  plan: string
  acknowledgements: string[]
}): Promise<void> {
  const { to, clinicName, acceptedByName, acceptedAt, termsVersion, plan, acknowledgements } =
    params
  const subject = `Agreement countersigned — Welcome to Medoflow, ${clinicName}`
  const acceptedAtStr = acceptedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const ackList = acknowledgements.map((a) => `<li style="margin: 4px 0;">${a}</li>`).join('')
  const ackText = acknowledgements.map((a) => `  • ${a}`).join('\n')
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px;">
      <h2 style="color: #4f46e5;">Agreement on file</h2>
      <p>Hi ${acceptedByName},</p>
      <p>This confirms that <strong>${clinicName}</strong> has accepted the Medoflow service agreement.</p>
      <div style="background: #f9f9f9; padding: 16px 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 4px 0;"><strong>Plan:</strong> ${plan}</p>
        <p style="margin: 4px 0;"><strong>Terms version:</strong> ${termsVersion}</p>
        <p style="margin: 4px 0;"><strong>Accepted by:</strong> ${acceptedByName}</p>
        <p style="margin: 4px 0;"><strong>Accepted at:</strong> ${acceptedAtStr}</p>
      </div>
      <p style="margin-top: 16px;"><strong>Acknowledgements on record:</strong></p>
      <ul style="padding-left: 20px;">${ackList}</ul>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="font-size: 12px; color: #777;">Keep this email for your records. You can request a countersigned PDF at any time from your clinic settings.</p>
    </div>
  `
  const text = `
Agreement on file

Hi ${acceptedByName},

This confirms that ${clinicName} has accepted the Medoflow service agreement.

Plan: ${plan}
Terms version: ${termsVersion}
Accepted by: ${acceptedByName}
Accepted at: ${acceptedAtStr}

Acknowledgements on record:
${ackText}

Keep this email for your records.
  `.trim()

  await sendEmail({ to, subject, html, text })
}

export async function sendStaffInviteEmail(params: {
  to: string
  name: string
  setupLink: string
  roleLabel: string
}): Promise<void> {
  const { to, name, setupLink, roleLabel } = params
  const subject = "You've been invited to Medoflow"
  const html = `
    <p>Hi ${name},</p>
    <p>You've been invited to join Medoflow as ${roleLabel}.</p>
    <p>Click the link below to set your password and get started:</p>
    <p><a href="${setupLink}">${setupLink}</a></p>
    <p>This link expires in 24 hours.</p>
    <p>If you didn't expect this invite, you can safely ignore this email.</p>
  `
  const text = `
Hi ${name},

You've been invited to join Medoflow as ${roleLabel}.

Set your password here: ${setupLink}

This link expires in 24 hours.

If you didn't expect this invite, you can safely ignore this email.
  `.trim()

  await sendEmail({ to, subject, html, text })
}

/**
 * New contact-form enquiry on a clinic website (B8.5). The email carries no
 * enquiry content — contact-form messages are PHI and are read only inside
 * the dashboard, where every read is audited.
 */
export async function sendSiteLeadNotification(params: {
  to: string
  clinicName: string
  inboxUrl: string
}): Promise<void> {
  const subject = `New website enquiry for ${params.clinicName}`
  const text = `You have a new enquiry from your website.\n\nSign in to read it: ${params.inboxUrl}\n`
  const html = `<p>You have a new enquiry from your website.</p><p><a href="${params.inboxUrl}">Sign in to read it</a></p>`
  await sendEmail({ to: params.to, subject, html, text })
}

// ─── Clinic onboarding: application review ──────────────────────────────────
// Names and notes are typed by clinics and reviewers, so they are escaped
// before going into HTML.

const escapeHtml = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const emailShell = (title: string, body: string) => `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px;">
      <h2 style="color: #4f46e5;">${title}</h2>
      ${body}
    </div>
  `

/** To the clinic owner, right after the application is submitted. */
export async function sendClinicApplicationReceived(params: {
  to: string
  name: string
  clinicName: string
  dashboardUrl: string
}): Promise<void> {
  const name = escapeHtml(params.name)
  const clinic = escapeHtml(params.clinicName)
  const subject = `We received ${params.clinicName}'s application`
  const html = emailShell(
    'Application received',
    `<p>Hi ${name},</p>
      <p>Thanks — we have the application for <strong>${clinic}</strong>. Our team verifies your NPI and licensing details; most applications are reviewed within one business day.</p>
      <p>You can keep setting up services, team and website in the meantime. Your public website and online booking switch on as soon as the clinic is approved.</p>
      <p><a href="${params.dashboardUrl}">Continue setup</a></p>`
  )
  const text = `Hi ${params.name},

Thanks — we have the application for ${params.clinicName}. Our team verifies your NPI and licensing details; most applications are reviewed within one business day.

You can keep setting up services, team and website in the meantime. Your public website and online booking switch on as soon as the clinic is approved.

Continue setup: ${params.dashboardUrl}`

  await sendEmail({ to: params.to, subject, html, text })
}

/** To the platform review inbox: a clinic application is waiting. */
export async function sendClinicApplicationForReview(params: {
  to: string
  clinicName: string
  legalName: string
  practiceType: string
  resubmitted: boolean
  reviewUrl: string
}): Promise<void> {
  const verb = params.resubmitted ? 'resubmitted' : 'submitted'
  const subject = `Clinic application ${verb}: ${params.clinicName}`
  const html = emailShell(
    `Clinic application ${verb}`,
    `<p><strong>${escapeHtml(params.clinicName)}</strong> (${escapeHtml(params.legalName)}, ${escapeHtml(params.practiceType)}) has ${verb} its application and is waiting for review.</p>
      <p><a href="${params.reviewUrl}">Open the application</a></p>`
  )
  const text = `${params.clinicName} (${params.legalName}, ${params.practiceType}) has ${verb} its application and is waiting for review.

Open the application: ${params.reviewUrl}`

  await sendEmail({ to: params.to, subject, html, text })
}

/** To the clinic owner: the reviewer's decision. */
export async function sendClinicReviewDecision(params: {
  to: string
  name: string
  clinicName: string
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED'
  notes: string | null
  dashboardUrl: string
}): Promise<void> {
  const clinic = escapeHtml(params.clinicName)
  const notesHtml = params.notes
    ? `<div style="background: #f9f9f9; padding: 12px 16px; border-radius: 8px; margin: 16px 0; white-space: pre-wrap;">${escapeHtml(params.notes)}</div>`
    : ''
  const copy = {
    APPROVED: {
      subject: `${params.clinicName} is approved — you're live`,
      title: 'Your clinic is approved',
      body: `<p><strong>${clinic}</strong> has been approved. Your public website and online booking are now switched on.</p>`,
      text: `${params.clinicName} has been approved. Your public website and online booking are now switched on.`,
    },
    CHANGES_REQUESTED: {
      subject: `Action needed on ${params.clinicName}'s application`,
      title: 'A few changes are needed',
      body: `<p>We reviewed the application for <strong>${clinic}</strong> and need a few changes before we can approve it:</p>`,
      text: `We reviewed the application for ${params.clinicName} and need a few changes before we can approve it:`,
    },
    REJECTED: {
      subject: `Update on ${params.clinicName}'s application`,
      title: 'Application not approved',
      body: `<p>We were unable to approve the application for <strong>${clinic}</strong>.</p>`,
      text: `We were unable to approve the application for ${params.clinicName}.`,
    },
  }[params.decision]
  const html = emailShell(
    copy.title,
    `<p>Hi ${escapeHtml(params.name)},</p>
      ${copy.body}
      ${notesHtml}
      <p><a href="${params.dashboardUrl}">Open your dashboard</a></p>`
  )
  const text = `Hi ${params.name},

${copy.text}
${params.notes ? `\n${params.notes}\n` : ''}
Open your dashboard: ${params.dashboardUrl}`

  await sendEmail({ to: params.to, subject: copy.subject, html, text })
}

/**
 * A clinic added this patient at the desk (CTO-24: walk-in / phone booking).
 * Optional: the booking never depends on it, and staff can copy the link
 * instead when SMTP isn't set up. Carries no clinical detail.
 */
export async function sendPatientInviteEmail(params: {
  to: string
  name: string
  clinicName: string
  setupLink: string
}): Promise<void> {
  const name = escapeHtml(params.name)
  const clinic = escapeHtml(params.clinicName)
  const subject = `Set up your ${params.clinicName} patient account`
  const html = `
    <p>Hi ${name},</p>
    <p>${clinic} has created a patient account for you on MedoFlow.</p>
    <p>Set your password to see your appointments, forms and orders:</p>
    <p><a href="${params.setupLink}">${params.setupLink}</a></p>
    <p>This link expires in 24 hours. If you weren't expecting it, you can ignore this email.</p>
  `
  const text = `Hi ${params.name},

${params.clinicName} has created a patient account for you on MedoFlow.

Set your password here: ${params.setupLink}

This link expires in 24 hours. If you weren't expecting it, you can ignore this email.`
  await sendEmail({ to: params.to, subject, html, text })
}

/**
 * A provider's appointment starts in 10 minutes (CTO-30). Deliberately
 * PHI-free: the time and a link, never the patient's name or the reason.
 */
export async function sendProviderStartingSoonEmail(params: {
  to: string
  title: string
  link: string
}): Promise<void> {
  const title = escapeHtml(params.title)
  await sendEmail({
    to: params.to,
    subject: params.title,
    html: `<p>${title}.</p><p><a href="${params.link}">Open the appointment and start AI Scribe</a></p>`,
    text: `${params.title}.\n\nOpen the appointment and start AI Scribe: ${params.link}`,
  })
}

/**
 * The patient's order is ready to check out (CTO-32). No product names or
 * clinical detail: those are behind the sign-in on the checkout page.
 */
export async function sendCartReadyEmail(params: {
  to: string
  name: string
  clinicName: string
  link: string
}): Promise<void> {
  const name = escapeHtml(params.name)
  const clinic = escapeHtml(params.clinicName)
  await sendEmail({
    to: params.to,
    subject: `Your order from ${params.clinicName} is ready`,
    html: `<p>Hi ${name},</p><p>${clinic} has prepared your order. Review it and check out here:</p><p><a href="${params.link}">${params.link}</a></p><p>The link works for 72 hours. You'll sign in to see the details.</p>`,
    text: `Hi ${params.name},\n\n${params.clinicName} has prepared your order. Review it and check out here: ${params.link}\n\nThe link works for 72 hours. You'll sign in to see the details.`,
  })
}
