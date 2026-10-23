import type { SiteTemplate } from './types'
import { templatePageRef } from './types'
import {
  bookCta,
  contactPage,
  privacyPage,
  sec,
  servicesPage,
  standardHours,
  teamPage,
} from './common'

/** Warm, friendly family practice: rounded shapes, soft greens and coral. */
export const heritage: SiteTemplate = {
  key: 'heritage',
  name: 'Heritage',
  tagline: 'Warm, friendly and family-first',
  description:
    'A welcoming, rounded design for family dental, pediatrics and community practices. Reassuring copy for nervous patients and a dedicated new-patient guide.',
  bestFor: ['Family dentistry', 'Pediatrics', 'Family medicine', 'Community clinics'],
  previewImage: '/site-samples/preview-heritage.svg',
  settings: {
    theme: {
      colors: {
        primary: '#0f766e',
        secondary: '#134e4a',
        accent: '#f97362',
        background: '#fffdf8',
        surface: '#f0f7f4',
        text: '#1f2933',
        muted: '#52606d',
      },
      fontPair: 'friendly',
      radius: 'xl',
      buttonStyle: 'pill',
      density: 'comfortable',
    },
    brand: { displayName: '', logo: null, favicon: null },
    header: {
      variant: 'classic',
      links: [
        { label: 'Services', link: { kind: 'route', route: 'services' } },
        { label: 'Meet us', link: { kind: 'route', route: 'team' } },
        { label: 'New patients', link: templatePageRef('new-patients') },
        { label: 'Contact', link: { kind: 'route', route: 'contact' } },
      ],
      cta: bookCta('Book a visit'),
      sticky: true,
    },
    footer: {
      variant: 'columns',
      columns: [
        {
          title: 'Patients',
          links: [
            { label: 'New patients', link: templatePageRef('new-patients') },
            { label: 'Services', link: { kind: 'route', route: 'services' } },
            { label: 'Book a visit', link: { kind: 'booking' } },
          ],
        },
        {
          title: 'About',
          links: [
            { label: 'Meet us', link: { kind: 'route', route: 'team' } },
            { label: 'Contact', link: { kind: 'route', route: 'contact' } },
            { label: 'Privacy notice', link: templatePageRef('privacy') },
          ],
        },
      ],
      text: 'Gentle care for every member of the family — from first visits to grandparents.',
    },
    announcement: {
      enabled: true,
      text: 'Welcoming new families — first check-ups for kids under 3 are free.',
      link: templatePageRef('new-patients'),
    },
    social: {},
    seo: {
      titleSuffix: '',
      description: 'Gentle, family-friendly care. Welcoming new patients of all ages.',
      ogImage: null,
    },
  },
  pages: [
    {
      kind: 'HOME',
      slug: 'home',
      title: 'Home',
      seoDescription: 'Gentle, family-friendly care. Welcoming new patients of all ages.',
      showInNav: false,
      sections: [
        sec('hero', 'centered', {
          eyebrow: 'Welcoming new families',
          headline: 'Gentle care for every smile in the family',
          subheadline:
            'Relaxed appointments, clear explanations and a team that makes even the most nervous patients feel at home.',
          primaryCta: bookCta('Book a visit'),
          secondaryCta: { label: 'New patient guide', link: templatePageRef('new-patients') },
          image: { src: '/site-samples/hero-heritage.svg', alt: 'A smiling family' },
        }),
        sec('service-grid', 'cards', {
          heading: 'Care for all ages',
          intro: 'Check-ups, cleanings, treatments and advice — under one friendly roof.',
          maxItems: 6,
          showPrices: false,
          showDuration: true,
        }),
        sec('image-with-text', 'image-right', {
          heading: 'Nervous? You’re in good hands',
          body: 'We explain every step before we start, agree on a signal to pause, and never rush.\n\n- Quiet rooms and headphones on request\n- Longer first appointments\n- Kids’ corner and parent-friendly scheduling',
          image: { src: '/site-samples/care-heritage.svg', alt: 'A calm, friendly treatment room' },
          cta: { label: 'Read the new patient guide', link: templatePageRef('new-patients') },
        }),
        sec('provider-bios', 'grid', {
          heading: 'Meet the family',
          intro: 'The friendly faces you will see at every visit.',
          maxItems: 4,
          showBio: true,
        }),
        sec('testimonials', 'cards', {
          heading: 'Kind words',
          items: [
            {
              quote: 'My son actually asks when his next check-up is.',
              author: 'Sample review',
              detail: 'Replace with a real, consented review',
            },
            {
              quote: 'They were so patient with my anxiety. First visit in years.',
              author: 'Sample review',
              detail: '',
            },
            {
              quote: 'Easy booking and appointments that run on time.',
              author: 'Sample review',
              detail: '',
            },
          ],
        }),
        sec('locations-hours', 'split', {
          heading: 'Find us',
          hours: standardHours,
          showMapLink: true,
        }),
        sec('booking-cta', 'banner', {
          heading: 'We’d love to meet you',
          text: 'New patients are always welcome.',
          cta: bookCta('Book a visit'),
        }),
      ],
    },
    servicesPage({
      heading: 'Our services',
      intro: 'Preventive and everyday care for children, adults and seniors.',
      closing: {
        heading: 'Questions about cost or insurance?',
        text: 'Our front desk is happy to help before you book.',
      },
    }),
    teamPage({
      title: 'Meet us',
      heading: 'Meet our team',
      intro: 'Experienced, gentle and part of the community.',
    }),
    {
      kind: 'STANDARD',
      slug: 'new-patients',
      title: 'New patients',
      seoDescription: 'Everything you need to know before your first visit.',
      showInNav: true,
      sections: [
        sec('steps', 'numbered', {
          heading: 'Your first visit',
          items: [
            { title: 'Book online', text: 'Choose a time that works — evening slots available.' },
            {
              title: 'Fill in a short form',
              text: 'We will send a secure intake form before your visit.',
            },
            {
              title: 'Meet the team',
              text: 'A relaxed first appointment with plenty of time for questions.',
            },
          ],
        }),
        sec('faq', 'accordion', {
          heading: 'New patient questions',
          items: [
            {
              question: 'What should I bring?',
              answer:
                'Photo ID, your insurance card if you have one, and a list of any medications.',
            },
            {
              question: 'Can I book for my whole family?',
              answer: 'Yes — book back-to-back appointments, or call us and we will arrange them.',
            },
            {
              question: 'Do you see young children?',
              answer: 'We see children from their very first tooth or first check-up.',
            },
          ],
        }),
        sec('booking-cta', 'split', {
          heading: 'Ready for your first visit?',
          text: 'It only takes a minute to book.',
          cta: bookCta(),
          image: { src: '/site-samples/care-heritage.svg', alt: 'Welcome' },
        }),
      ],
    },
    contactPage({
      heading: 'Contact us',
      intro: 'Have a question before you book? Send us a message and we will get back to you.',
      hours: standardHours,
    }),
    privacyPage(),
  ],
}
