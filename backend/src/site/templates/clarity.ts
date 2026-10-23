import type { SiteTemplate } from './types'
import { templatePageRef } from './types'
import {
  bookCta,
  contactPage,
  privacyPage,
  routeCta,
  sec,
  servicesPage,
  standardHours,
  teamPage,
} from './common'

/** Clean, trustworthy primary care: blue on white, generous whitespace. */
export const clarity: SiteTemplate = {
  key: 'clarity',
  name: 'Clarity',
  tagline: 'Calm, clinical and easy to trust',
  description:
    'A clean, high-contrast layout for primary care and general practice. Clear service listings, prominent booking and a reassuring tone.',
  bestFor: ['Primary care', 'General practice', 'Urgent care', 'Telehealth'],
  previewImage: '/site-samples/preview-clarity.svg',
  settings: {
    theme: {
      colors: {
        primary: '#1d4ed8',
        secondary: '#1e3a8a',
        accent: '#0ea5e9',
        background: '#ffffff',
        surface: '#f1f5f9',
        text: '#0f172a',
        muted: '#475569',
      },
      fontPair: 'modern',
      radius: 'md',
      buttonStyle: 'solid',
      density: 'comfortable',
    },
    brand: { displayName: '', logo: null, favicon: null },
    header: {
      variant: 'classic',
      links: [
        { label: 'Services', link: { kind: 'route', route: 'services' } },
        { label: 'Our doctors', link: { kind: 'route', route: 'team' } },
        { label: 'About', link: templatePageRef('about') },
        { label: 'Contact', link: { kind: 'route', route: 'contact' } },
      ],
      cta: bookCta('Book a visit'),
      sticky: true,
    },
    footer: {
      variant: 'columns',
      columns: [
        {
          title: 'Care',
          links: [
            { label: 'All services', link: { kind: 'route', route: 'services' } },
            { label: 'Book a visit', link: { kind: 'booking' } },
          ],
        },
        {
          title: 'Practice',
          links: [
            { label: 'About us', link: templatePageRef('about') },
            { label: 'Our doctors', link: { kind: 'route', route: 'team' } },
            { label: 'Privacy notice', link: templatePageRef('privacy') },
          ],
        },
      ],
      text: 'Same-week appointments, in person or by video. In an emergency, call 911.',
    },
    announcement: {
      enabled: true,
      text: 'Now booking flu and seasonal vaccinations — walk-ins welcome on weekday mornings.',
      link: { kind: 'route', route: 'services' },
    },
    social: {},
    seo: {
      titleSuffix: '',
      description: 'Modern primary care with same-week appointments, in person or by video.',
      ogImage: null,
    },
  },
  pages: [
    {
      kind: 'HOME',
      slug: 'home',
      title: 'Home',
      seoDescription: 'Modern primary care with same-week appointments, in person or by video.',
      showInNav: false,
      sections: [
        sec('hero', 'split', {
          eyebrow: 'Primary care, made simple',
          headline: 'Healthcare that starts with listening',
          subheadline:
            'Same-week appointments with doctors who take the time to understand you. Book online in under a minute — in person or by video.',
          primaryCta: bookCta('Book a visit'),
          secondaryCta: routeCta('Explore services', 'services'),
          image: { src: '/site-samples/hero-clarity.svg', alt: 'A bright, welcoming clinic' },
        }),
        sec('trust-bar', 'stats', {
          heading: '',
          stats: [
            { value: 'Same week', label: 'appointments' },
            { value: '15 min', label: 'average wait' },
            { value: 'Video', label: 'or in-person visits' },
            { value: '4.9 ★', label: 'patient rating' },
          ],
        }),
        sec('service-grid', 'cards', {
          heading: 'How we can help',
          intro:
            'From annual check-ups to managing long-term conditions, we cover your everyday care.',
          maxItems: 6,
          showPrices: true,
          showDuration: true,
        }),
        sec('steps', 'numbered', {
          heading: 'Getting care is easy',
          items: [
            {
              title: 'Choose a time',
              text: 'Pick a service and a time that suits you — online, 24/7.',
            },
            { title: 'Meet your doctor', text: 'Visit us in person or join securely by video.' },
            {
              title: 'Follow up online',
              text: 'See visit summaries, invoices and next steps in your portal.',
            },
          ],
        }),
        sec('provider-bios', 'grid', {
          heading: 'Meet our doctors',
          intro: 'Experienced clinicians who know you by name.',
          maxItems: 3,
          showBio: true,
        }),
        sec('testimonials', 'cards', {
          heading: 'What our patients say',
          items: [
            {
              quote: 'Booking took a minute and the doctor actually had time for my questions.',
              author: 'Sample review',
              detail: 'Replace with a real, consented review',
            },
            {
              quote: 'The video visit saved me an afternoon off work.',
              author: 'Sample review',
              detail: '',
            },
            {
              quote: 'Friendly front desk and no waiting room marathon.',
              author: 'Sample review',
              detail: '',
            },
          ],
        }),
        sec('faq', 'accordion', {
          heading: 'Common questions',
          items: [
            {
              question: 'Do you take new patients?',
              answer:
                'Yes. Book any available appointment online and we will set up your record before the visit.',
            },
            {
              question: 'Do you offer video visits?',
              answer:
                'Many follow-ups and routine concerns can be handled by secure video. Choose a video appointment when booking.',
            },
            {
              question: 'How do I cancel or reschedule?',
              answer:
                'Use the link in your confirmation email or your patient portal. Please give us 24 hours’ notice.',
            },
          ],
        }),
        sec('booking-cta', 'banner', {
          heading: 'Ready when you are',
          text: 'Most weekdays have same-day availability.',
          cta: bookCta('Find an appointment'),
        }),
      ],
    },
    servicesPage({
      heading: 'Our services',
      intro:
        'Everyday care for every stage of life. Prices shown are self-pay; insured visits may differ.',
      variant: 'list',
      closing: {
        heading: 'Not sure what to book?',
        text: 'Choose a general consultation and we will guide you from there.',
      },
    }),
    teamPage({
      title: 'Our doctors',
      heading: 'Our doctors',
      intro:
        'Board-certified clinicians focused on prevention, clear explanations and continuity of care.',
    }),
    {
      kind: 'STANDARD',
      slug: 'about',
      title: 'About us',
      seoDescription: 'Who we are and how we care for our community.',
      showInNav: true,
      sections: [
        sec('image-with-text', 'image-right', {
          heading: 'Care built around you',
          body: 'We started this practice to make primary care feel personal again: **longer appointments**, clear explanations and doctors who follow up.\n\nToday we care for families across the neighbourhood, in person and online.',
          image: { src: '/site-samples/team-clarity.svg', alt: 'Our care team' },
          cta: bookCta('Book a visit'),
        }),
        sec('steps', 'cards', {
          heading: 'What we believe',
          items: [
            { title: 'Time to listen', text: 'Appointments long enough for real conversations.' },
            {
              title: 'Prevention first',
              text: 'Screenings and plans that keep small issues small.',
            },
            { title: 'Care that connects', text: 'One team that knows your history.' },
          ],
        }),
      ],
    },
    contactPage({
      heading: 'Get in touch',
      intro:
        'Questions about appointments, billing or our services? Send us a note and we will reply within one business day.',
      hours: standardHours,
    }),
    privacyPage(),
  ],
}
