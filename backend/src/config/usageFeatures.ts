/**
 * CTO-39: the catalog of product features whose use is counted across clinics.
 *
 * This file is the single source of truth for usage analytics:
 *  - `trackUsage(key)` only accepts keys listed here.
 *  - `logAudit` emits a usage event for an audit row only when its action
 *    (or `ACTION:EntityType`) appears in `auditActions` below. Every other
 *    audit action is ignored (default deny).
 *  - The platform Usage page lists every feature here, so a feature nobody
 *    used still shows (PostHog cannot report on events it never received).
 *
 * Adding a feature is a config change: add a row, then (when there is no audit
 * row for it) call `trackUsage` at its success point. A test checks that each
 * listed audit action is written somewhere in the backend, so the catalog
 * cannot silently drift from the code.
 */

export const USAGE_AREAS = [
  'scribe',
  'video',
  'scheduling',
  'commerce',
  'intake',
  'website',
  'onboarding',
  'staff',
] as const
export type UsageArea = (typeof USAGE_AREAS)[number]

export const USAGE_AREA_LABELS: Record<UsageArea, string> = {
  scribe: 'AI Scribe and consult',
  video: 'Video visits',
  scheduling: 'Scheduling',
  commerce: 'Commerce',
  intake: 'Intake and forms',
  website: 'Website',
  onboarding: 'Onboarding and integrations',
  staff: 'Staff and sign-in',
}

export interface UsageFeature {
  key: string
  area: UsageArea
  label: string
  /** Audit actions (`ACTION` or `ACTION:EntityType`) that count as one use. */
  auditActions?: readonly string[]
}

export const USAGE_FEATURES = [
  // ── AI Scribe and consult (C2) ──
  {
    key: 'scribe.session_started',
    area: 'scribe',
    label: 'Scribe session started',
    auditActions: ['AI_SCRIBE_SESSION_CREATED'],
  },
  { key: 'scribe.recording_started', area: 'scribe', label: 'Consult recording started' },
  {
    key: 'scribe.draft_generated',
    area: 'scribe',
    label: 'Scribe draft generated',
    auditActions: ['AI_DRAFT_GENERATED', 'AI_DRAFT_REGENERATED'],
  },
  {
    key: 'scribe.draft_edited',
    area: 'scribe',
    label: 'Scribe draft edited',
    auditActions: ['AI_DRAFT_EDITED'],
  },
  { key: 'scribe.approved', area: 'scribe', label: 'Scribe draft approved' },
  {
    key: 'scribe.summary_published',
    area: 'scribe',
    label: 'Patient summary sent',
    auditActions: ['PATIENT_SUMMARY_PUBLISHED'],
  },
  {
    key: 'consult.visit_finalized',
    area: 'scribe',
    label: 'Visit note finalized',
    auditActions: ['VISIT_FINALIZED'],
  },
  {
    key: 'consult.live_transcription',
    area: 'scribe',
    label: 'Live transcription started',
    auditActions: ['TRANSCRIPTION_STARTED'],
  },
  {
    key: 'consult.consent',
    area: 'scribe',
    label: 'Recording consent captured',
    auditActions: [
      'CONSENT_GRANTED',
      'CONSENT_ATTESTED',
      'CONSENT_ATTESTED_VERBAL',
      'CONSENT_DECLINED',
    ],
  },

  // ── Video (C2) ──
  {
    key: 'video.room_created',
    area: 'video',
    label: 'Video room created',
    auditActions: ['VIDEO_ROOM_CREATED'],
  },
  {
    key: 'video.joined',
    area: 'video',
    label: 'Video call joined',
    auditActions: ['VIDEO_TOKEN_ISSUED'],
  },
  {
    key: 'video.auto_ended',
    area: 'video',
    label: 'Idle video call auto-ended',
    auditActions: ['VIDEO_CALL_AUTO_ENDED'],
  },

  // ── Scheduling (C1) ──
  { key: 'appointment.created', area: 'scheduling', label: 'Appointment booked' },
  {
    key: 'appointment.rescheduled',
    area: 'scheduling',
    label: 'Appointment rescheduled',
    auditActions: ['APPOINTMENT_RESCHEDULED'],
  },
  {
    key: 'appointment.cancelled',
    area: 'scheduling',
    label: 'Appointment cancelled',
    auditActions: ['APPOINTMENT_CANCELLED'],
  },
  {
    key: 'appointment.recurring_created',
    area: 'scheduling',
    label: 'Recurring series booked',
    auditActions: ['RECURRING_SERIES_CREATED'],
  },
  { key: 'appointment.completed', area: 'scheduling', label: 'Appointment completed' },
  { key: 'appointment.no_show', area: 'scheduling', label: 'Appointment marked no-show' },
  {
    key: 'waitlist.joined',
    area: 'scheduling',
    label: 'Waitlist joined',
    auditActions: ['WAITLIST_JOINED'],
  },
  {
    key: 'waitlist.booked',
    area: 'scheduling',
    label: 'Waitlist offer booked',
    auditActions: ['WAITLIST_BOOKED'],
  },

  // ── Commerce (C5) ──
  {
    key: 'rxcart.built',
    area: 'commerce',
    label: 'Rx cart built from scribe',
    auditActions: ['RX_CART_BUILT'],
  },
  {
    key: 'rxcart.confirmed',
    area: 'commerce',
    label: 'Rx cart confirmed',
    auditActions: ['RX_CART_CONFIRMED'],
  },
  {
    key: 'checkout_link.sent',
    area: 'commerce',
    label: 'Checkout link sent',
    auditActions: ['CHECKOUT_LINK_SENT'],
  },
  {
    key: 'checkout_link.opened',
    area: 'commerce',
    label: 'Checkout link opened',
    auditActions: ['CHECKOUT_LINK_OPENED'],
  },
  {
    key: 'cart.checkout',
    area: 'commerce',
    label: 'Cart checked out',
    auditActions: ['CART_CHECKOUT'],
  },
  {
    key: 'payment.confirmed',
    area: 'commerce',
    label: 'Online payment confirmed',
    auditActions: ['PAYMENT_CONFIRMED'],
  },
  {
    key: 'pos.invoice_finalized',
    area: 'commerce',
    label: 'Front-desk invoice finalized',
    auditActions: ['INVOICE_FINALIZED'],
  },
  {
    key: 'pos.manual_payment',
    area: 'commerce',
    label: 'Front-desk payment recorded',
    auditActions: ['MANUAL_PAYMENT_RECORDED'],
  },
  { key: 'product.created', area: 'commerce', label: 'Storefront product added' },
  { key: 'inventory.adjusted', area: 'commerce', label: 'Stock adjusted' },
  {
    key: 'catalog.store_connected',
    area: 'commerce',
    label: 'Outside store connected (Shopify, Square, WooCommerce, Wix)',
    auditActions: ['STORE_CONNECTED'],
  },
  {
    key: 'catalog.import_applied',
    area: 'commerce',
    label: 'Product catalog imported',
    auditActions: ['CATALOG_IMPORT_APPLIED'],
  },
  { key: 'membership.purchased', area: 'commerce', label: 'Membership payment received' },
  {
    key: 'treatment_plan.created',
    area: 'commerce',
    label: 'Treatment plan created',
    auditActions: ['TREATMENT_PLAN_CREATED'],
  },

  // ── Intake and forms (C3) ──
  {
    key: 'intake.submitted',
    area: 'intake',
    label: 'Intake form submitted',
    auditActions: ['FORM_RESPONSE_SUBMITTED'],
  },
  {
    key: 'forms.template_created',
    area: 'intake',
    label: 'Form template created',
    auditActions: ['FORM_TEMPLATE_CREATED'],
  },

  // ── Website (C8) ──
  {
    key: 'site.template_installed',
    area: 'website',
    label: 'Website template installed',
    auditActions: ['SITE_TEMPLATE_INSTALLED'],
  },
  {
    key: 'site.page_published',
    area: 'website',
    label: 'Website page published',
    auditActions: ['SITE_PAGE_PUBLISHED'],
  },
  {
    key: 'site.published',
    area: 'website',
    label: 'Website published',
    auditActions: ['SITE_PUBLISHED'],
  },
  {
    key: 'site.address_live',
    area: 'website',
    label: 'Website address went live',
    auditActions: ['SITE_ADDRESS_LIVE'],
  },
  {
    key: 'site.address_failed',
    area: 'website',
    label: 'Website launch failed',
    auditActions: ['SITE_ADDRESS_FAILED'],
  },
  {
    key: 'site.domain_added',
    area: 'website',
    label: 'Custom domain added',
    auditActions: ['SITE_DOMAIN_ADDED'],
  },
  {
    key: 'site.asset_uploaded',
    area: 'website',
    label: 'Website image uploaded',
    auditActions: ['SITE_ASSET_UPLOADED'],
  },

  // ── Onboarding, lifecycle and integrations ──
  {
    key: 'clinic.signup',
    area: 'onboarding',
    label: 'Clinic signed up',
    auditActions: ['TENANT_SIGNUP'],
  },
  {
    key: 'clinic.agreement_signed',
    area: 'onboarding',
    label: 'Clinic agreement signed',
    auditActions: ['TERMS_ACCEPTED'],
  },
  {
    key: 'clinic.approved',
    area: 'onboarding',
    label: 'Clinic approved',
    auditActions: ['CLINIC_APPROVED'],
  },
  {
    key: 'clinic.offboarded',
    area: 'onboarding',
    label: 'Clinic offboarded',
    auditActions: ['TENANT_OFFBOARDED'],
  },
  { key: 'onboarding.brand_saved', area: 'onboarding', label: 'Brand saved' },
  { key: 'onboarding.npi_lookup', area: 'onboarding', label: 'NPI registry lookup' },
  { key: 'calendar.google_connected', area: 'onboarding', label: 'Google Calendar connected' },

  // ── Staff and sign-in ──
  { key: 'auth.login', area: 'staff', label: 'Signed in' },
  { key: 'staff.invited', area: 'staff', label: 'Staff member invited' },
  {
    key: 'staff.invite_accepted',
    area: 'staff',
    label: 'Staff invite accepted',
    auditActions: ['PASSWORD_SET'],
  },
  {
    key: 'patient.created',
    area: 'staff',
    label: 'Patient record created',
    auditActions: ['PATIENT_CREATED'],
  },
] as const satisfies readonly UsageFeature[]

export type UsageFeatureKey = (typeof USAGE_FEATURES)[number]['key']

const BY_KEY = new Map<string, UsageFeature>(USAGE_FEATURES.map((f) => [f.key, f]))

const BY_AUDIT_ACTION = new Map<string, UsageFeature>()
for (const f of USAGE_FEATURES as readonly UsageFeature[]) {
  for (const a of f.auditActions ?? []) {
    if (BY_AUDIT_ACTION.has(a)) throw new Error(`usageFeatures: audit action ${a} mapped twice`)
    BY_AUDIT_ACTION.set(a, f)
  }
}

export const getUsageFeature = (key: string): UsageFeature | undefined => BY_KEY.get(key)

/** The feature an audit row counts towards, or undefined (most rows count towards none). */
export const featureForAuditAction = (
  action: string,
  entityType?: string | null
): UsageFeature | undefined =>
  (entityType ? BY_AUDIT_ACTION.get(`${action}:${entityType}`) : undefined) ??
  BY_AUDIT_ACTION.get(action)
