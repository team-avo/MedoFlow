export interface TourStep {
  /** element lookup: `[data-tour-id="<anchor>"]`; if null, renders as centered modal */
  anchor: string | null
  title: string
  body: string
  placement?: 'right' | 'bottom' | 'left' | 'top' | 'center'
  /** optional href: clicking "Next" will route here before advancing */
  routeTo?: string
}

export interface TourScript {
  id: string
  label: string
  steps: TourStep[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Clinic Owner / Super Admin, 5 steps per PRD §6.4
// ─────────────────────────────────────────────────────────────────────────────
export const superAdminTour: TourScript = {
  id: 'super-admin',
  label: 'Owner tour',
  steps: [
    {
      anchor: null,
      placement: 'center',
      title: 'Welcome to MedoFlow',
      body: "Here's a quick 60-second tour of your clinic's command center. You can skip or replay this anytime from the menu.",
    },
    {
      anchor: 'nav-dashboard-admin',
      placement: 'right',
      title: 'Command Center',
      body: 'See revenue, appointment volume, and clinic health at a glance. This is your home base.',
      routeTo: '/dashboard/admin',
    },
    {
      anchor: 'nav-dashboard-appointments',
      placement: 'right',
      title: 'Appointments',
      body: 'Every visit across your providers and locations, with quick filters and status badges.',
    },
    {
      anchor: 'nav-dashboard-patients',
      placement: 'right',
      title: 'Patients',
      body: 'Patient records, EMR history, and scribe notes: one row per person, full timeline one click away.',
    },
    {
      anchor: 'nav-dashboard-services',
      placement: 'right',
      title: 'Services',
      body: 'The clinical menu patients see and book from. Keep pricing and durations accurate here.',
    },
    {
      anchor: 'nav-dashboard-analytics',
      placement: 'right',
      title: 'Analytics',
      body: 'Revenue trends, provider utilization, and cohort performance, refreshed nightly.',
    },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider: 3 steps (Schedule, Patient records, AI Scribe)
// ─────────────────────────────────────────────────────────────────────────────
export const providerTour: TourScript = {
  id: 'provider',
  label: 'Provider tour',
  steps: [
    {
      anchor: null,
      placement: 'center',
      title: "Let's get you clinical-ready",
      body: "In 30 seconds we'll walk through your calendar, patient timelines, and the AI Scribe.",
    },
    {
      anchor: 'nav-dashboard-provider-calendar',
      placement: 'right',
      title: 'Your Calendar',
      body: 'Daily and weekly views, drag-to-reschedule, and availability rules all live here.',
    },
    {
      anchor: 'nav-dashboard-appointments',
      placement: 'right',
      title: 'Patient Records',
      body: 'Open any visit to see the full patient timeline: previous notes, medications, and files.',
    },
    {
      anchor: 'kpi-ai-scribe',
      placement: 'bottom',
      title: 'AI Scribe',
      body: 'Record a consultation and get structured SOAP notes in under a minute. Review and sign off before locking.',
    },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Front Desk: 3 steps (Appointments, Billing/POS, Patients)
// ─────────────────────────────────────────────────────────────────────────────
export const frontDeskTour: TourScript = {
  id: 'front-desk',
  label: 'Front-desk tour',
  steps: [
    {
      anchor: null,
      placement: 'center',
      title: 'Welcome to the front desk',
      body: 'A quick look at the three things you’ll use most: scheduling, billing, and patients.',
    },
    {
      anchor: 'nav-dashboard-appointments',
      placement: 'right',
      title: 'Appointments',
      body: "Today's schedule, check-ins, and rescheduling, all in one place.",
    },
    {
      anchor: 'nav-dashboard-front-desk-pos',
      placement: 'right',
      title: 'Checkout & POS',
      body: 'Take payments, apply memberships or packages, and issue receipts in a few taps.',
    },
    {
      anchor: 'nav-dashboard-patients',
      placement: 'right',
      title: 'Patients',
      body: 'Search, update contact info, upload intake forms, and start new visits.',
    },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Patient: 3 steps on the public site / My Account
// ─────────────────────────────────────────────────────────────────────────────
export const patientTour: TourScript = {
  id: 'patient',
  label: 'Patient tour',
  steps: [
    {
      anchor: 'account-overview',
      placement: 'bottom',
      title: 'Your clinic, in your pocket',
      body: 'Everything you need (upcoming visits, records, and billing) lives right here.',
    },
    {
      anchor: 'account-book',
      placement: 'bottom',
      title: 'Book an appointment',
      body: "Browse services and pick a time with any of your clinic's providers.",
    },
    {
      anchor: 'account-profile',
      placement: 'bottom',
      title: 'Profile',
      body: 'Keep your contact details, preferences, and insurance up to date.',
    },
  ],
}
