import type { SiteTemplate } from './types'
import { templatePageRef } from './types'
import { bookCta, contactPage, privacyPage, routeCta, sec, servicesPage, teamPage } from './common'

/** Earthy, organic integrative medicine: sage greens, Fraunces headings. */
export const botanica: SiteTemplate = {
  key: 'botanica',
  name: 'Botanica',
  tagline: 'Earthy, holistic and grounded',
  description:
    'An organic, nature-inspired design for naturopathic, integrative and functional medicine practices. Explains your approach and sells supplements through the built-in shop.',
  bestFor: ['Naturopathy', 'Integrative medicine', 'Functional medicine', 'Nutrition'],
  previewImage: '/site-samples/preview-botanica.svg',
  settings: {
    theme: {
      colors: {
        primary: '#3f6212',
        secondary: '#1a2e05',
        accent: '#b45309',
        background: '#fbfaf5',
        surface: '#eef2e6',
        text: '#1c1917',
        muted: '#57534e',
      },
      fontPair: 'organic',
      radius: 'lg',
      buttonStyle: 'outline',
      density: 'spacious',
    },
    brand: { displayName: '', logo: null, favicon: null },
    header: {
      variant: 'minimal',
      links: [
        { label: 'Approach', link: templatePageRef('approach') },
        { label: 'Services', link: { kind: 'route', route: 'services' } },
        { label: 'Practitioners', link: { kind: 'route', route: 'team' } },
        { label: 'Shop', link: { kind: 'route', route: 'store' } },
        { label: 'Contact', link: { kind: 'route', route: 'contact' } },
      ],
      cta: bookCta('Book a consult'),
      sticky: false,
    },
    footer: {
      variant: 'simple',
      columns: [],
      text: 'Root-cause care that treats the whole person. Supplements are not intended to diagnose, treat, cure or prevent any disease.',
    },
    announcement: { enabled: false, text: '', link: null },
    social: {},
    seo: {
      titleSuffix: '',
      description:
        'Integrative, root-cause care for lasting health — naturopathic consultations, nutrition and supplements.',
      ogImage: null,
    },
  },
  pages: [
    {
      kind: 'HOME',
      slug: 'home',
      title: 'Home',
      seoDescription:
        'Integrative, root-cause care for lasting health — naturopathic consultations, nutrition and supplements.',
      showInNav: false,
      sections: [
        sec('hero', 'split', {
          eyebrow: 'Integrative & naturopathic care',
          headline: 'Get to the root of how you feel',
          subheadline:
            'Unhurried consultations that look at sleep, stress, nutrition and history together — then a plan that fits your life.',
          primaryCta: bookCta('Book a consult'),
          secondaryCta: { label: 'Our approach', link: templatePageRef('approach') },
          image: { src: '/site-samples/hero-botanica.svg', alt: 'Fresh herbs and leaves' },
        }),
        sec('steps', 'numbered', {
          heading: 'How we work together',
          items: [
            { title: 'Listen', text: 'A 60-minute first consultation covering your full story.' },
            { title: 'Investigate', text: 'Targeted testing only where it changes your plan.' },
            {
              title: 'Restore',
              text: 'Nutrition, lifestyle and natural therapies, reviewed as you progress.',
            },
          ],
        }),
        sec('service-grid', 'list', {
          heading: 'Consultations',
          intro: 'Book a first visit, a follow-up or a focused nutrition session.',
          maxItems: 6,
          showPrices: true,
          showDuration: true,
        }),
        sec('featured-products', 'grid', {
          heading: 'From our dispensary',
          intro: 'Practitioner-grade supplements, chosen for quality and purity.',
          maxItems: 4,
        }),
        sec('testimonials', 'quote', {
          heading: '',
          items: [
            {
              quote:
                'For the first time someone looked at the whole picture. I have my energy back.',
              author: 'Sample review',
              detail: 'Replace with a real, consented review',
            },
          ],
        }),
        sec('booking-cta', 'banner', {
          heading: 'Begin with a conversation',
          text: 'Free 15-minute discovery calls available every week.',
          cta: bookCta('Book a consult'),
        }),
      ],
    },
    {
      kind: 'STANDARD',
      slug: 'approach',
      title: 'Our approach',
      seoDescription: 'Whole-person, evidence-informed integrative medicine.',
      showInNav: true,
      sections: [
        sec('image-with-text', 'image-left', {
          heading: 'Whole-person medicine',
          body: 'Symptoms rarely have a single cause. We take time to understand how your body, routines and environment fit together.\n\nOur practitioners combine **evidence-informed natural therapies** with conventional testing, and we work alongside your other doctors.',
          image: { src: '/site-samples/leaves-botanica.svg', alt: 'Botanical illustration' },
          cta: routeCta('Meet our practitioners', 'team'),
        }),
        sec('faq', 'two-column', {
          heading: 'Good to know',
          items: [
            {
              question: 'Do you replace my regular doctor?',
              answer:
                'No — we work alongside your primary care provider and share notes with your consent.',
            },
            {
              question: 'Is testing always required?',
              answer: 'Only when the result would change your plan.',
            },
            {
              question: 'Can I buy supplements without a visit?',
              answer:
                'Many are available in our shop; some practitioner-only products need a consultation first.',
            },
          ],
        }),
      ],
    },
    servicesPage({
      heading: 'Services',
      intro: 'First consultations, follow-ups and focused nutrition sessions.',
      variant: 'list',
      closing: {
        heading: 'Not sure which visit?',
        text: 'Start with a first consultation — we will guide you from there.',
      },
    }),
    teamPage({
      title: 'Practitioners',
      heading: 'Our practitioners',
      intro: 'Licensed naturopathic doctors and nutrition professionals.',
    }),
    contactPage({
      heading: 'Contact the clinic',
      intro: 'Questions about our approach, products or which visit to book? We are here to help.',
      hours: [
        { label: 'Monday – Thursday', value: '9:00 am – 6:00 pm' },
        { label: 'Friday', value: '9:00 am – 3:00 pm' },
        { label: 'Weekend', value: 'Closed' },
      ],
      variant: 'simple',
    }),
    privacyPage(),
  ],
}
