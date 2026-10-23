/**
 * 404 for clinic websites — a real 404 status with the clinic's own header,
 * footer and theme. not-found components get no route params, so the site
 * comes from the x-mf-site request header set by middleware.ts.
 */
import { headers } from 'next/headers'
import { fetchSitePage, siteBaseFor } from '@/lib/site/renderApi'
import { SITE_HEADER } from '@/lib/site/edgeRouting'
import { siteFontVariables } from '@/components/site/fonts'
import { LiveSite } from '@/components/site/LiveSite'

export const metadata = { title: 'Page not found', robots: { index: false, follow: false } }

export default async function ClinicSiteNotFound() {
  const site = (await headers()).get(SITE_HEADER)
  const result = site ? await fetchSitePage(site, '/__not-found__').catch(() => null) : null
  if (result?.kind !== 'page') {
    return (
      <main
        style={{
          minHeight: '60vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem' }}>There’s no website here</h1>
          <p style={{ color: '#64748b' }}>Check the address and try again.</p>
        </div>
      </main>
    )
  }
  return (
    <LiveSite
      payload={result.payload}
      base={siteBaseFor(site!)}
      mode="live"
      fontClassName={siteFontVariables}
    />
  )
}
