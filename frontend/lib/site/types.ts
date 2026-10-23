/**
 * Clinic-website (Component 8) shapes shared by the public renderer and the
 * builder. They mirror the backend render payload
 * (backend/src/site/services/renderService.ts) and content schemas
 * (backend/src/site/content/*).
 */

export type LinkableRoute = 'home' | 'services' | 'team' | 'store' | 'book' | 'contact'

/** A stored link: names its target, never a raw in-site URL. */
export type SiteLink =
  | { kind: 'page'; pageId: string }
  | { kind: 'route'; route: LinkableRoute }
  | { kind: 'service'; serviceId: string }
  | { kind: 'provider'; providerId: string }
  | { kind: 'product'; productId: string }
  | { kind: 'booking'; serviceId?: string }
  | { kind: 'anchor'; sectionId: string }
  | { kind: 'external'; href: string }

/** A link as rendered: `href` is resolved server-side (null = target gone). */
export type ResolvedLink = SiteLink & { href?: string | null }

export interface Cta {
  label: string
  link: ResolvedLink
}

export interface ImageRef {
  assetId?: string
  src?: string
  alt: string
  /** Added at render time. */
  url?: string | null
  width?: number | null
  height?: number | null
}

export type FontPair = 'modern' | 'friendly' | 'editorial' | 'classic' | 'bold' | 'organic'

export interface SiteTheme {
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    surface: string
    text: string
    muted: string
  }
  fontPair: FontPair
  radius: 'none' | 'sm' | 'md' | 'lg' | 'xl'
  buttonStyle: 'solid' | 'outline' | 'pill'
  density: 'compact' | 'comfortable' | 'spacious'
}

export interface NavItem {
  label: string
  link: ResolvedLink
}

export interface SiteSettings {
  theme: SiteTheme
  brand: { displayName: string; logo: ImageRef | null; favicon: ImageRef | null }
  header: {
    variant: 'classic' | 'centered' | 'minimal'
    links: NavItem[]
    cta: Cta | null
    sticky: boolean
  }
  footer: {
    variant: 'columns' | 'simple'
    columns: { title: string; links: NavItem[] }[]
    text: string
  }
  announcement: { enabled: boolean; text: string; link: ResolvedLink | null }
  social: Partial<
    Record<'facebook' | 'instagram' | 'x' | 'linkedin' | 'youtube' | 'tiktok', string>
  >
  seo: { titleSuffix: string; description: string; ogImage: ImageRef | null }
}

export type SectionType =
  | 'hero'
  | 'trust-bar'
  | 'service-grid'
  | 'provider-bios'
  | 'image-with-text'
  | 'gallery'
  | 'testimonials'
  | 'faq'
  | 'pricing'
  | 'featured-products'
  | 'locations-hours'
  | 'contact-form'
  | 'booking-cta'
  | 'video'
  | 'rich-text'
  | 'steps'
  | 'spacer'

export interface Section {
  id: string
  type: SectionType
  variant: string
  hidden: boolean
  settings: Record<string, unknown>
}

export type PageKind = 'HOME' | 'STANDARD' | 'SERVICES' | 'TEAM' | 'CONTACT' | 'LEGAL'

export interface PublicService {
  id: string
  slug: string | null
  name: string
  durationMinutes: number
  price: string
  discipline: string | null
}
export interface PublicProvider {
  id: string
  slug: string | null
  name: string
  bio: string | null
  headshotUrl: string | null
  languages: string[]
  disciplines: string[]
  serviceIds: string[]
}
export interface PublicProduct {
  id: string
  slug: string | null
  name: string
  description: string | null
  price: string
  inStock: boolean
}

export interface SectionData {
  services: PublicService[]
  providers: PublicProvider[]
  products: PublicProduct[]
  packages: {
    id: string
    name: string
    description: string | null
    price: string
    totalSessions: number | null
    expiresInDays: number | null
  }[]
  memberships: {
    id: string
    name: string
    description: string | null
    monthlyPrice: string
    serviceDiscountPercent: string
    billingPeriod: string
  }[]
  locations: {
    id: string
    name: string
    addressLines: string[]
    phone: string | null
    timezone: string
    isVirtual: boolean
  }[]
}

export type SiteRouteKey =
  | 'home'
  | 'page'
  | 'services'
  | 'service'
  | 'team'
  | 'provider'
  | 'store'
  | 'product'
  | 'book'
  | 'contact'
  | 'legal'
  | 'preview'
  | 'sitemap'
  | 'robots'
  | 'favicon'

export interface RenderPayload {
  site: {
    clinicId: string
    name: string
    slug: string | null
    canonicalBase: string
    settings: SiteSettings
    showBadge: boolean
    legacyLogoUrl: string | null
    hasStore: boolean
  }
  route: { key: SiteRouteKey | 'not-found'; path: string; params: Record<string, string> }
  page: {
    id: string
    kind: PageKind
    title: string
    seoTitle: string | null
    seoDescription: string | null
    noindex: boolean
    sections: Section[]
  } | null
  entity:
    | { type: 'service'; service: PublicService }
    | { type: 'provider'; provider: PublicProvider }
    | { type: 'product'; product: PublicProduct }
    | { type: 'book'; serviceId: string | null }
    | null
  data: SectionData
  preview: boolean
}

export type RenderResponse =
  | { kind: 'page'; status: number; payload: RenderPayload }
  | { kind: 'redirect'; to: string; code: 301 | 302 }
  | { kind: 'unknown' }
