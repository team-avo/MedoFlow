/**
 * Builder API client (F8): every call the website builder makes, in one
 * place, against /api/v1/site/* (authenticated) and /api/v1/public/sites/*.
 */
import api from '@/lib/api'
import type { PageKind, RenderPayload, Section, SiteSettings, SiteTheme } from './types'

const data = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data)

export interface SitePageSummary {
  id: string
  kind: PageKind
  slug: string
  path: string
  title: string
  status: 'DRAFT' | 'PUBLISHED'
  showInNav: boolean
  navOrder: number
  noindex: boolean
  version: number
  publishedAt: string | null
  updatedAt: string
  hasUnpublishedChanges: boolean
}

export interface SitePageDetail extends SitePageSummary {
  seoTitle: string | null
  seoDescription: string | null
  ogImageAssetId: string | null
  sections: Section[]
  live: {
    title: string
    seoTitle: string | null
    seoDescription: string | null
    sections: Section[]
  }
}

export interface SiteEntitlements {
  maxPages: number
  maxCustomDomains: number
  canRemoveBadge: boolean
  maxAssets: number
}

export interface SiteOverview {
  id: string
  clinic: { id: string; name: string; slug: string | null; legacyLogoUrl: string | null }
  templateKey: string | null
  version: number
  publishedAt: string | null
  settings: SiteSettings
  settingsPublished: SiteSettings | null
  hasUnpublishedSettings: boolean
  pages: SitePageSummary[]
  urls: {
    canonical: string
    canonicalKind: 'domain' | 'app'
    subdomain: string | null
    appPath: string | null
    custom: string[]
  }
  entitlements: SiteEntitlements
}

export interface TemplateSummary {
  key: string
  name: string
  tagline: string
  description: string
  bestFor: string[]
  previewImage: string
  theme: SiteTheme
  pages: { kind: PageKind; slug: string; title: string }[]
}

export interface SiteAsset {
  id: string
  url: string | null
  mimeType: string
  size: number
  width: number | null
  height: number | null
  alt: string
  status: 'PENDING' | 'AVAILABLE' | 'REJECTED'
  createdAt: string
}

export interface DnsRecord {
  type: 'CNAME' | 'TXT' | 'A' | 'AAAA'
  name: string
  value: string
  purpose: 'routing' | 'ownership' | 'certificate'
}

export interface SiteDomain {
  id: string
  kind: 'SUBDOMAIN' | 'CUSTOM'
  hostname: string
  status: 'PENDING' | 'VERIFIED' | 'FAILED'
  isPrimary: boolean
  sslStatus: string | null
  lastError: string | null
  lastCheckedAt: string | null
  verifiedAt: string | null
  url: string
  records: DnsRecord[]
}

export interface SiteRedirect {
  id: string
  fromPath: string
  toPath: string
  code: number
  auto: boolean
  createdAt: string
}

export interface SiteLeadSummary {
  id: string
  name: string
  email: string
  phone: string | null
  status: 'NEW' | 'READ' | 'ARCHIVED'
  sourcePath: string | null
  readAt: string | null
  createdAt: string
}

export const siteApi = {
  // Site
  getSite: () => data<SiteOverview>(api.get('/site')),
  saveSettings: (settings: SiteSettings) =>
    data<{ settings: SiteSettings }>(api.put('/site/settings', { settings })).then(
      (r) => r.settings
    ),
  publishSite: (pageIds: string[] | 'all' = 'all') =>
    data<SiteOverview>(api.post('/site/publish', { pageIds })),
  previewLink: (pageId: string) =>
    data<{ token: string; url: string; expiresAt: string }>(
      api.post('/site/preview-link', { pageId })
    ),
  aiHomeCopy: () => data<{ generated: boolean; pageId: string }>(api.post('/site/ai/home-copy')),
  setEntitySlug: (entity: 'service' | 'provider' | 'product', id: string, slug: string) =>
    data<{ id: string; slug: string }>(api.put(`/site/slugs/${entity}/${id}`, { slug })),

  // Templates
  listTemplates: () =>
    data<{ items: TemplateSummary[] }>(api.get('/site/templates')).then((r) => r.items),
  installTemplate: (key: string, mode: 'replace' | 'styles-only') =>
    data<SiteOverview>(api.post(`/site/templates/${key}/install`, { mode })),

  // Pages
  listPages: () => data<{ items: SitePageSummary[] }>(api.get('/site/pages')).then((r) => r.items),
  createPage: (input: {
    kind?: PageKind
    slug?: string
    title: string
    sections?: Section[]
    showInNav?: boolean
  }) => data<SitePageDetail>(api.post('/site/pages', input)),
  getPage: (id: string) => data<SitePageDetail>(api.get(`/site/pages/${id}`)),
  savePage: (
    id: string,
    input: Partial<{
      title: string
      slug: string
      sections: Section[]
      seoTitle: string | null
      seoDescription: string | null
      ogImageAssetId: string | null
      showInNav: boolean
      navOrder: number
      noindex: boolean
    }>
  ) => data<SitePageDetail>(api.put(`/site/pages/${id}`, input)),
  publishPage: (id: string) => data<SitePageDetail>(api.post(`/site/pages/${id}/publish`)),
  unpublishPage: (id: string) => data<SitePageDetail>(api.post(`/site/pages/${id}/unpublish`)),
  duplicatePage: (id: string) => data<SitePageDetail>(api.post(`/site/pages/${id}/duplicate`)),
  deletePage: (id: string) => api.delete(`/site/pages/${id}`).then(() => undefined),
  listRevisions: (id: string) =>
    data<{ items: { id: string; version: number; title: string; createdAt: string }[] }>(
      api.get(`/site/pages/${id}/revisions`)
    ).then((r) => r.items),
  restoreRevision: (id: string, version: number) =>
    data<SitePageDetail>(api.post(`/site/pages/${id}/revisions/${version}/restore`)),

  // Images
  listAssets: () => data<{ items: SiteAsset[] }>(api.get('/site/assets')).then((r) => r.items),
  uploadAsset: async (file: File, alt = '') => {
    const intent = await data<{
      assetId: string
      upload: { url: string; method: 'PUT'; headers: Record<string, string> }
    }>(api.post('/site/assets/uploads', { mimeType: file.type, size: file.size, alt }))
    const put = await fetch(intent.upload.url, {
      method: 'PUT',
      headers: intent.upload.headers,
      body: file,
      credentials: 'omit',
    })
    if (!put.ok) throw new Error('The upload did not complete — please try again')
    return data<SiteAsset>(api.post(`/site/assets/${intent.assetId}/complete`))
  },
  updateAssetAlt: (id: string, alt: string) =>
    data<SiteAsset>(api.patch(`/site/assets/${id}`, { alt })),
  deleteAsset: (id: string) => api.delete(`/site/assets/${id}`).then(() => undefined),

  // Domains
  listDomains: () => data<{ rootDomain: string; domains: SiteDomain[] }>(api.get('/site/domains')),
  addDomain: (hostname: string) => data<SiteDomain>(api.post('/site/domains', { hostname })),
  verifyDomain: (id: string) => data<SiteDomain>(api.post(`/site/domains/${id}/verify`)),
  setPrimaryDomain: (id: string) =>
    data<{ rootDomain: string; domains: SiteDomain[] }>(api.post(`/site/domains/${id}/primary`)),
  removeDomain: (id: string) =>
    data<{ rootDomain: string; domains: SiteDomain[] }>(api.delete(`/site/domains/${id}`)),
  changeSubdomain: (label: string) =>
    data<{ rootDomain: string; domains: SiteDomain[] }>(
      api.put('/site/domains/subdomain', { label })
    ),

  // Redirects
  listRedirects: () =>
    data<{ items: SiteRedirect[] }>(api.get('/site/redirects')).then((r) => r.items),
  createRedirect: (fromPath: string, toPath: string) =>
    data<SiteRedirect>(api.post('/site/redirects', { fromPath, toPath })),
  importRedirects: (csv: string) =>
    data<{ results: { line: number; fromPath: string; ok: boolean; error?: string }[] }>(
      api.post('/site/redirects/import', { csv })
    ).then((r) => r.results),
  deleteRedirect: (id: string) => api.delete(`/site/redirects/${id}`).then(() => undefined),

  // Enquiries
  listLeads: (status?: 'NEW' | 'READ' | 'ARCHIVED') =>
    data<{ items: SiteLeadSummary[]; unread: number }>(
      api.get('/site/leads', { params: status ? { status } : {} })
    ),
  readLead: (id: string) =>
    data<SiteLeadSummary & { message: string }>(api.get(`/site/leads/${id}`)),
  setLeadStatus: (id: string, status: 'NEW' | 'READ' | 'ARCHIVED') =>
    data<{ id: string; status: string }>(api.patch(`/site/leads/${id}`, { status })),

  // Public (gallery preview, editor canvas data)
  templatePreview: (key: string, page?: string) =>
    data<RenderPayload>(
      api.get(`/public/sites/templates/${key}/preview`, { params: page ? { page } : {} })
    ),
  renderLive: (clinic: string, path: string) =>
    data<RenderPayload>(api.get('/public/sites/render', { params: { clinic, path } })),
}

/** Human message for an API error from the builder. */
export function siteErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string }
  return e?.response?.data?.message || e?.message || fallback
}
