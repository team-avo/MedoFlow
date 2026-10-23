/**
 * Every page of every clinic website (Component 8). Server-rendered for
 * SEO: one API call (render) returns the published theme, menus, the
 * matched route and only the data its sections use. Routing decisions
 * (canonical host, redirects, drafts never public, 404) are made by the API.
 *
 * Reached via middleware.ts:  <clinic-host>/<path>  or  <app>/s/<slug>/<path>
 */
import type { Metadata } from 'next'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { cache } from 'react'
import { fetchSitePage, siteBaseFor } from '@/lib/site/renderApi'
import { withSiteBase } from '@/lib/site/routes'
import { jsonLd, safeJsonLd, siteMetadata } from '@/lib/site/seo'
import { siteFontVariables } from '@/components/site/fonts'
import { LiveSite } from '@/components/site/LiveSite'

type Props = {
  params: Promise<{ siteId: string; slug?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const sitePath = (path?: string[]) =>
  `/${(path ?? []).map((p) => encodeURIComponent(decodeURIComponent(p))).join('/')}`

const load = cache(async (site: string, path: string, preview?: string) =>
  fetchSitePage(site, path, preview)
)

async function resolve(props: Props) {
  const { siteId: site, slug: path } = await props.params
  const sp = await props.searchParams
  const preview = typeof sp.token === 'string' ? sp.token : undefined
  const p = sitePath(path)
  return { site, path: p, preview, result: await load(site, p, preview) }
}

/**
 * Unknown sites, missing pages and redirects become real HTTP 404 / 308 /
 * 307 responses: nothing streams above this route (there is deliberately no
 * root app/loading.tsx), so the status is decided before the first byte.
 * ../not-found.tsx renders the 404 in the site's own branding.
 */
function routeOrThrow(site: string, result: Awaited<ReturnType<typeof fetchSitePage>>) {
  if (result.kind === 'unknown' || (result.kind === 'page' && result.status === 404)) notFound()
  if (result.kind === 'redirect') {
    const to = /^https?:\/\//.test(result.to)
      ? result.to
      : withSiteBase(siteBaseFor(site), result.to)
    if (result.code === 302) redirect(to)
    permanentRedirect(to)
  }
  return result
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { site, result } = await resolve(props)
  const page = routeOrThrow(site, result)
  return siteMetadata(page.payload, { status: page.status })
}

export default async function ClinicSitePage(props: Props) {
  const { site, result } = await resolve(props)
  const base = siteBaseFor(site)
  const { payload } = routeOrThrow(site, result)
  // /book/<service-slug> goes straight into the app's booking flow.
  if (payload.entity?.type === 'book' && payload.entity.serviceId) {
    redirect(
      `/book/${encodeURIComponent(payload.entity.serviceId)}?clinicId=${encodeURIComponent(payload.site.clinicId)}`
    )
  }
  return (
    <>
      {jsonLd(payload).map((data, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
        />
      ))}
      <LiveSite
        payload={payload}
        base={base}
        mode={payload.preview ? 'preview' : 'live'}
        fontClassName={siteFontVariables}
      />
    </>
  )
}
