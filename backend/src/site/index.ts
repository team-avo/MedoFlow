/**
 * Component 8 — clinic website platform. Two routers, mounted once each in
 * routes/index.ts:
 *   siteAdminRouter   /api/v1/site/*            builder (authenticated)
 *   sitePublicRouter  /api/v1/public/sites/*    render, resolve, sitemap, leads
 * Specific prefixes are mounted before the site-wide router, because each
 * sub-router applies its own role guard to everything that reaches it.
 */
import { Router } from 'express'
import siteRoutes from './http/admin/site.routes'
import templateRoutes from './http/admin/templates.routes'
import pageRoutes from './http/admin/pages.routes'
import assetRoutes from './http/admin/assets.routes'
import domainRoutes from './http/admin/domains.routes'
import redirectRoutes from './http/admin/redirects.routes'
import leadRoutes from './http/admin/leads.routes'
import publicSiteRoutes from './http/public/sites.routes'

export const siteAdminRouter = Router()
siteAdminRouter.use('/templates', templateRoutes)
siteAdminRouter.use('/pages', pageRoutes)
siteAdminRouter.use('/assets', assetRoutes)
siteAdminRouter.use('/domains', domainRoutes)
siteAdminRouter.use('/redirects', redirectRoutes)
siteAdminRouter.use('/leads', leadRoutes)
siteAdminRouter.use('/', siteRoutes)

/**
 * The first builder's /site-pages API, kept for one release as an alias of
 * /site/pages (same handlers, same audit) with a Deprecation header.
 */
export const legacySitePagesRouter = Router()
legacySitePagesRouter.use((_req, res, next) => {
  res.set('Deprecation', 'true')
  res.set('Link', '</api/v1/site/pages>; rel="successor-version"')
  next()
})
legacySitePagesRouter.use('/', pageRoutes)

export const sitePublicRouter = publicSiteRoutes
