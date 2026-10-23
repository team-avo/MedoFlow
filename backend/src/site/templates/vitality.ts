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

/** Bold, energetic sports-medicine look: dark navy, electric accent. */
export const vitality: SiteTemplate = {
  key: 'vitality',
  name: 'Vitality',
  tagline: 'Bold, energetic and results-driven',
  description:
    'A high-contrast, confident design for physiotherapy, chiropractic and sports medicine. Puts conditions, outcomes and fast booking front and centre.',
  bestFor: ['Physiotherapy', 'Chiropractic', 'Sports medicine', 'Rehabilitation'],
  previewImage: '/site-samples/preview-vitality.svg',
  settings: {
    theme: {
      colors: {
        primary: '#ea580c',
        secondary: '#0b1324',
        accent: '#facc15',
        background: '#ffffff',
        surface: '#f3f4f6',
        text: '#0b1324',
        muted: '#4b5563',
      },
      fontPair: 'bold',
      radius: 'sm',
      buttonStyle: 'solid',
      density: 'compact',
    },
    brand: { displayName: '', logo: null, favicon: null },
    header: {
      variant: 'classic',
      links: [
        { label: 'Conditions', link: templatePageRef('conditions') },
        { label: 'Treatments', link: { kind: 'route', route: 'services' } },
        { label: 'Team', link: { kind: 'route', route: 'team' } },
        { label: 'Contact', link: { kind: 'route', route: 'contact' } },
      ],
      cta: bookCta('Book assessment'),
      sticky: true,
    },
    footer: {
      variant: 'columns',
      columns: [
        {
          title: 'Get moving',
          links: [
            { label: 'Conditions we treat', link: templatePageRef('conditions') },
            { label: 'Treatments', link: { kind: 'route', route: 'services' } },
            { label: 'Book assessment', link: { kind: 'booking' } },
          ],
        },
        {
          title: 'Clinic',
          links: [
            { label: 'Our team', link: { kind: 'route', route: 'team' } },
            { label: 'Contact', link: { kind: 'route', route: 'contact' } },
            { label: 'Privacy notice', link: templatePageRef('privacy') },
          ],
        },
      ],
      text: 'Evidence-based rehab that gets you back to the things you love.',
    },
    announcement: { enabled: false, text: '', link: null },
    social: {},
    seo: {
      titleSuffix: '',
      description:
        'Physiotherapy and sports medicine that gets you moving again — fast assessments, clear plans.',
      ogImage: null,
    },
  },
  pages: [
    {
      kind: 'HOME',
      slug: 'home',
      title: 'Home',
      seoDescription:
        'Physiotherapy and sports medicine that gets you moving again — fast assessments, clear plans.',
      showInNav: false,
      sections: [
        sec('hero', 'image', {
          eyebrow: 'Physio · Sports medicine · Rehab',
          headline: 'Move better. Recover faster.',
          subheadline:
            'One-to-one assessments, hands-on treatment and a clear plan to get you back to full strength.',
          primaryCta: bookCta('Book an assessment'),
          secondaryCta: { label: 'Conditions we treat', link: templatePageRef('conditions') },
          image: { src: '/site-samples/hero-vitality.svg', alt: 'An athlete stretching' },
        }),
        sec('trust-bar', 'stats', {
          heading: '',
          stats: [
            { value: '48 h', label: 'to your first assessment' },
            { value: '1:1', label: 'every session' },
            { value: '92%', label: 'reach their goals' },
          ],
        }),
        sec('steps', 'cards', {
          heading: 'Your road to recovery',
          items: [
            { title: 'Assess', text: 'A thorough movement assessment to find the root cause.' },
            { title: 'Treat', text: 'Hands-on therapy plus targeted exercise.' },
            { title: 'Strengthen', text: 'A progressive plan so it doesn’t come back.' },
          ],
        }),
        sec('service-grid', 'cards', {
          heading: 'Treatments',
          intro: 'Evidence-based care for injuries, pain and performance.',
          maxItems: 6,
          showPrices: true,
          showDuration: true,
        }),
        sec('gallery', 'grid', {
          heading: 'Inside the clinic',
          images: [
            { src: '/site-samples/gym-vitality.svg', alt: 'Rehab gym floor' },
            { src: '/site-samples/hero-vitality.svg', alt: 'Mobility training' },
            { src: '/site-samples/team-clarity.svg', alt: 'Our clinicians' },
          ],
        }),
        sec('provider-bios', 'grid', {
          heading: 'Your team',
          intro:
            'Physiotherapists and sports clinicians who treat athletes and everyday movers alike.',
          maxItems: 4,
          showBio: true,
        }),
        sec('booking-cta', 'banner', {
          heading: 'Don’t let pain decide your plans',
          text: 'Assessments available within 48 hours.',
          cta: bookCta('Book now'),
        }),
      ],
    },
    {
      kind: 'STANDARD',
      slug: 'conditions',
      title: 'Conditions we treat',
      seoDescription: 'Back and neck pain, sports injuries, post-surgery rehab and more.',
      showInNav: true,
      sections: [
        sec('rich-text', 'left', {
          heading: 'Conditions we treat',
          body: 'We help with a wide range of musculoskeletal problems, including:\n\n- Back and neck pain\n- Sports injuries — sprains, strains and tendon problems\n- Knee, hip and shoulder pain\n- Post-surgical rehabilitation\n- Headaches linked to posture and tension\n- Work and desk-related aches\n\nNot on the list? [Get in touch](/contact) — if we can’t help, we will point you to someone who can.',
        }),
        sec('faq', 'accordion', {
          heading: 'Before your first visit',
          items: [
            {
              question: 'Do I need a referral?',
              answer:
                'No. You can book directly. Some insurers require one for reimbursement — check your plan.',
            },
            {
              question: 'What should I wear?',
              answer: 'Comfortable clothing that lets us see and move the area being treated.',
            },
            {
              question: 'How many sessions will I need?',
              answer:
                'Most people notice a difference within 3–6 sessions. We will give you a clear estimate at your assessment.',
            },
          ],
        }),
      ],
    },
    servicesPage({
      heading: 'Treatments',
      intro:
        'Every plan starts with an assessment. Session lengths and self-pay prices are shown below.',
      closing: {
        heading: 'Start with an assessment',
        text: 'We will find the cause and build your plan.',
      },
    }),
    teamPage({
      title: 'Team',
      heading: 'Meet the team',
      intro: 'Registered physiotherapists and sports clinicians with specialist training.',
    }),
    contactPage({
      heading: 'Talk to the clinic',
      intro: 'Questions about an injury, insurance or which session to book? Send us a message.',
      hours: standardHours,
    }),
    privacyPage(),
  ],
}
