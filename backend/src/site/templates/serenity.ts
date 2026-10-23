import type { SiteTemplate } from './types'
import { templatePageRef } from './types'
import { bookCta, contactPage, privacyPage, routeCta, sec, servicesPage, teamPage } from './common'

/** Soft, editorial wellness / med-spa look: warm neutrals, serif headings. */
export const serenity: SiteTemplate = {
  key: 'serenity',
  name: 'Serenity',
  tagline: 'Soft, elegant and restorative',
  description:
    'An editorial layout with serif headings and warm neutrals for wellness studios, med-spas and aesthetic clinics. Showcases treatments, memberships and products.',
  bestFor: ['Med-spa', 'Aesthetics', 'Wellness', 'Massage therapy'],
  previewImage: '/site-samples/preview-serenity.svg',
  settings: {
    theme: {
      colors: {
        primary: '#9a6b4f',
        secondary: '#5c4033',
        accent: '#c8a27c',
        background: '#fdfaf6',
        surface: '#f4ece3',
        text: '#2d2420',
        muted: '#6b5b52',
      },
      fontPair: 'editorial',
      radius: 'xl',
      buttonStyle: 'pill',
      density: 'spacious',
    },
    brand: { displayName: '', logo: null, favicon: null },
    header: {
      variant: 'centered',
      links: [
        { label: 'Treatments', link: { kind: 'route', route: 'services' } },
        { label: 'Memberships', link: templatePageRef('memberships') },
        { label: 'Shop', link: { kind: 'route', route: 'store' } },
        { label: 'About', link: templatePageRef('about') },
        { label: 'Contact', link: { kind: 'route', route: 'contact' } },
      ],
      cta: bookCta('Book'),
      sticky: true,
    },
    footer: {
      variant: 'columns',
      columns: [
        {
          title: 'Visit',
          links: [
            { label: 'Treatments', link: { kind: 'route', route: 'services' } },
            { label: 'Memberships', link: templatePageRef('memberships') },
            { label: 'Book', link: { kind: 'booking' } },
          ],
        },
        {
          title: 'Studio',
          links: [
            { label: 'Our story', link: templatePageRef('about') },
            { label: 'Practitioners', link: { kind: 'route', route: 'team' } },
            { label: 'Privacy notice', link: templatePageRef('privacy') },
          ],
        },
      ],
      text: 'A quiet space to restore, renew and feel like yourself.',
    },
    announcement: {
      enabled: true,
      text: 'New this season: members save on every treatment.',
      link: templatePageRef('memberships'),
    },
    social: {},
    seo: {
      titleSuffix: '',
      description:
        'Restorative treatments, skin care and wellness memberships in a calm, private studio.',
      ogImage: null,
    },
  },
  pages: [
    {
      kind: 'HOME',
      slug: 'home',
      title: 'Home',
      seoDescription:
        'Restorative treatments, skin care and wellness memberships in a calm, private studio.',
      showInNav: false,
      sections: [
        sec('hero', 'image', {
          eyebrow: 'Wellness & aesthetics',
          headline: 'Feel restored, inside and out',
          subheadline:
            'Thoughtful treatments delivered by licensed practitioners in a calm, private studio.',
          primaryCta: bookCta('Book a treatment'),
          secondaryCta: routeCta('View treatments', 'services'),
          image: {
            src: '/site-samples/hero-serenity.svg',
            alt: 'Soft natural light in a treatment room',
          },
        }),
        sec('image-with-text', 'image-left', {
          heading: 'A slower kind of care',
          body: 'Every visit begins with a consultation, so your plan fits your goals — never a one-size-fits-all menu.\n\n*Unhurried appointments. Honest advice. Results that look like you.*',
          image: { src: '/site-samples/wellness-serenity.svg', alt: 'Botanical skincare products' },
          cta: routeCta('Our approach', 'contact'),
        }),
        sec('service-grid', 'featured', {
          heading: 'Signature treatments',
          intro: 'Our most-loved treatments, each tailored at your consultation.',
          maxItems: 4,
          showPrices: true,
          showDuration: true,
        }),
        sec('pricing', 'memberships', {
          heading: 'Membership',
          intro: 'Join to save on every visit and enjoy priority booking.',
          maxItems: 3,
        }),
        sec('testimonials', 'quote', {
          heading: '',
          items: [
            {
              quote: 'The most relaxing hour of my month — and my skin has never looked better.',
              author: 'Sample review',
              detail: 'Replace with a real, consented review',
            },
          ],
        }),
        sec('featured-products', 'row', {
          heading: 'Take the ritual home',
          intro: 'Practitioner-selected products to extend your results.',
          maxItems: 4,
        }),
        sec('booking-cta', 'split', {
          heading: 'Your time to unwind',
          text: 'Evening and weekend appointments available.',
          cta: bookCta('Book now'),
          image: { src: '/site-samples/detail-serenity.svg', alt: 'A calm treatment space' },
        }),
      ],
    },
    servicesPage({
      heading: 'Treatments',
      intro: 'Every treatment starts with a short consultation so we can tailor it to you.',
      variant: 'featured',
      closing: {
        heading: 'Not sure where to start?',
        text: 'Book a consultation and we will create a plan together.',
      },
    }),
    {
      kind: 'STANDARD',
      slug: 'memberships',
      title: 'Memberships',
      seoDescription: 'Save on every treatment with a monthly membership.',
      showInNav: true,
      sections: [
        sec('pricing', 'both', {
          heading: 'Memberships & packages',
          intro: 'Commit to your routine and save. Cancel any time after your first three months.',
          maxItems: 6,
        }),
        sec('faq', 'two-column', {
          heading: 'Membership questions',
          items: [
            {
              question: 'Can I pause my membership?',
              answer: 'Yes — pause for up to two months a year from your account.',
            },
            {
              question: 'Do unused credits roll over?',
              answer: 'Credits roll over for 90 days while your membership is active.',
            },
            {
              question: 'Can I share my membership?',
              answer:
                'Memberships are personal, but you can buy gift packages for friends and family.',
            },
          ],
        }),
      ],
    },
    teamPage({
      title: 'Practitioners',
      heading: 'Our practitioners',
      intro: 'Licensed, experienced and genuinely kind.',
      variant: 'carousel',
    }),
    {
      kind: 'STANDARD',
      slug: 'about',
      title: 'Our story',
      seoDescription: 'Why we built a calmer kind of clinic.',
      showInNav: false,
      sections: [
        sec('rich-text', 'center', {
          heading: 'Our story',
          body: 'We opened our studio to bring medical-grade expertise into a space that feels like a retreat.\n\nEvery practitioner is licensed, every product is chosen with care, and every plan starts with a conversation.',
        }),
        sec('gallery', 'strip', {
          heading: 'Inside the studio',
          images: [
            { src: '/site-samples/wellness-serenity.svg', alt: 'Products on a shelf' },
            { src: '/site-samples/detail-serenity.svg', alt: 'Treatment room' },
            { src: '/site-samples/hero-serenity.svg', alt: 'Reception area' },
          ],
        }),
      ],
    },
    contactPage({
      heading: 'Say hello',
      intro: 'Questions about a treatment or membership? We would love to hear from you.',
      hours: [
        { label: 'Tuesday – Friday', value: '10:00 am – 8:00 pm' },
        { label: 'Saturday', value: '9:00 am – 5:00 pm' },
        { label: 'Sunday – Monday', value: 'Closed' },
      ],
      variant: 'simple',
    }),
    privacyPage(),
  ],
}
