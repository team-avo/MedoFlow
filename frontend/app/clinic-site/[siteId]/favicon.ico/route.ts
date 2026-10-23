/** /favicon.ico of a clinic site → its uploaded favicon (or logo), else the default icon. */
import { fetchSitePage } from '@/lib/site/renderApi'

export async function GET(req: Request, ctx: { params: Promise<{ siteId: string }> }) {
  const { siteId: site } = await ctx.params
  const page = await fetchSitePage(site, '/').catch(() => null)
  const brand = page?.kind === 'page' ? page.payload.site.settings.brand : null
  const icon = brand?.favicon?.url ?? brand?.logo?.url
  const target =
    icon && /^https?:\/\//.test(icon) ? icon : new URL('/medoflow-icon.png', req.url).toString()
  return Response.redirect(target, 302)
}
