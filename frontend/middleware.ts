/**
 * Edge routing for clinic websites (Component 8 / B8.2). The rules live in
 * lib/site/edgeRouting.ts (unit-tested); this file only applies them.
 * A new clinic or custom domain needs no deploy: the renderer asks the API
 * which clinic a host belongs to.
 *
 * Next.js 16 deprecates `middleware.ts` in favour of `proxy.ts`, but a proxy
 * always runs on the Node.js runtime, which OpenNext calls experimental and
 * unsupported on Cloudflare Workers. `middleware.ts` keeps the edge runtime
 * that OpenNext supports, so it stays until OpenNext supports `proxy.ts`.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { decideEdgeRoute, SITE_HEADER } from '@/lib/site/edgeRouting'

export function middleware(req: NextRequest) {
  const decision = decideEdgeRoute({
    // The Host header only: x-forwarded-host is client-controlled.
    host: req.headers.get('host'),
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
    appOrigin: process.env.NEXT_PUBLIC_APP_URL,
  })
  switch (decision.action) {
    case 'next':
      return NextResponse.next()
    case 'notFound':
      return new NextResponse('Not found', { status: 404 })
    case 'redirect':
      // Relative targets (legacy /clinic/* URLs) stay on the requested host.
      return NextResponse.redirect(new URL(decision.url, req.url), decision.status)
    case 'rewrite': {
      const url = req.nextUrl.clone()
      url.pathname = decision.pathname
      // Tell the site tree which site this is, so its not-found page can be
      // branded too (not-found components don't receive route params).
      const headers = new Headers(req.headers)
      headers.set(SITE_HEADER, decision.pathname.split('/')[2] ?? '')
      return NextResponse.rewrite(url, { request: { headers } })
    }
  }
}

export const config = {
  // Everything except build assets and bundled template artwork.
  matcher: ['/((?!_next/static|_next/image|site-samples/).*)'],
}
