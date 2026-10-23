/** /robots.txt of a clinic site. Unknown hosts and the /s/ fallback are not indexed. */
import { fetchSitemap, siteTarget } from '@/lib/site/renderApi'
import { robotsTxt } from '@/lib/site/sitemap'

export async function GET(_req: Request, ctx: { params: Promise<{ siteId: string }> }) {
  const { siteId: site } = await ctx.params
  const map = siteTarget(site).host ? await fetchSitemap(site) : null
  return new Response(robotsTxt(map?.canonicalBase ?? null), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300',
    },
  })
}
