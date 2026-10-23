/**
 * Pages every template ships with in some form: services, team, contact and
 * a privacy notice. Templates override the copy; the structure is shared.
 */
import type { LinkableRoute } from '../routing/routeKeys'
import type { TemplatePage, TemplateSection } from './types'

export const sec = (
  type: TemplateSection['type'],
  variant: string,
  settings: Record<string, unknown>
): TemplateSection => ({ type, variant, settings })

export const bookCta = (label = 'Book an appointment') => ({
  label,
  link: { kind: 'booking' as const },
})
export const routeCta = (label: string, route: LinkableRoute) => ({
  label,
  link: { kind: 'route' as const, route },
})

export function servicesPage(opts: {
  heading: string
  intro: string
  variant?: string
  closing: { heading: string; text: string }
}): TemplatePage {
  return {
    kind: 'SERVICES',
    slug: 'services',
    title: 'Services',
    seoDescription: opts.intro.slice(0, 160),
    showInNav: true,
    sections: [
      sec('service-grid', opts.variant ?? 'cards', {
        heading: opts.heading,
        intro: opts.intro,
        maxItems: 24,
        showPrices: true,
        showDuration: true,
      }),
      sec('booking-cta', 'banner', {
        heading: opts.closing.heading,
        text: opts.closing.text,
        cta: bookCta(),
      }),
    ],
  }
}

export function teamPage(opts: {
  title: string
  heading: string
  intro: string
  variant?: string
}): TemplatePage {
  return {
    kind: 'TEAM',
    slug: 'team',
    title: opts.title,
    seoDescription: opts.intro.slice(0, 160),
    showInNav: true,
    sections: [
      sec('provider-bios', opts.variant ?? 'grid', {
        heading: opts.heading,
        intro: opts.intro,
        maxItems: 24,
        showBio: true,
      }),
    ],
  }
}

export function contactPage(opts: {
  heading: string
  intro: string
  hours: { label: string; value: string }[]
  variant?: string
}): TemplatePage {
  return {
    kind: 'CONTACT',
    slug: 'contact',
    title: 'Contact',
    seoDescription: opts.intro.slice(0, 160),
    showInNav: true,
    sections: [
      sec('contact-form', opts.variant ?? 'split', {
        heading: opts.heading,
        intro: opts.intro,
        submitLabel: 'Send message',
        successMessage: 'Thank you — a member of our team will reply within one business day.',
        askPhone: true,
        consentText:
          'Please don’t include detailed medical information in this form. For urgent concerns call us; in an emergency dial 911.',
      }),
      sec('locations-hours', 'cards', {
        heading: 'Visit us',
        hours: opts.hours,
        showMapLink: true,
      }),
    ],
  }
}

export const privacyPage = (): TemplatePage => ({
  kind: 'LEGAL',
  slug: 'privacy',
  title: 'Privacy notice',
  seoDescription: 'How we collect, use and protect your information.',
  showInNav: false,
  sections: [
    sec('rich-text', 'left', {
      heading: 'Privacy notice',
      body: [
        '**Replace this page with your clinic’s Notice of Privacy Practices before you publish.**',
        '',
        'This website collects the information you choose to send us — for example through the contact form or when you book an appointment — so that we can respond and provide care.',
        '',
        '- We use your information to answer enquiries, schedule visits and send appointment reminders.',
        '- We never sell your information.',
        '- Clinical information is handled under our Notice of Privacy Practices, available on request.',
        '',
        'Questions about privacy? Contact us using the details on our [contact page](/contact).',
      ].join('\n'),
    }),
  ],
})

export const standardHours = [
  { label: 'Monday – Friday', value: '8:00 am – 6:00 pm' },
  { label: 'Saturday', value: '9:00 am – 1:00 pm' },
  { label: 'Sunday', value: 'Closed' },
]
