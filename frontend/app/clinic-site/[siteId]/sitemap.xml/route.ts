/** /sitemap.xml of a clinic site: published, indexable URLs on its canonical origin. */
import { fetchSitemap } from '@/lib/site/renderApi'
import { sitemapXml } from '@/lib/site/sitemap'

export async function GET(_req: Request, ctx: { params: Promise<{ siteId: string }> }) {
  const { siteId: site } = await ctx.params
  const map = await fetchSitemap(site)
  if (!map) return new Response('Not found', { status: 404 })
  return new Response(sitemapXml(map.entries), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300',
    },
  })
}
