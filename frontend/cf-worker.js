// Cloudflare entry for the MedoFlow frontend. Wraps the OpenNext-generated
// handler (built into .open-next/ by `opennextjs-cloudflare build`) to redirect
// retired addresses, then enforce HTTPS and HSTS before any page is rendered.
import { default as handler } from './.open-next/worker.js'
import { retiredHostRedirect } from './lib/site/retiredHostRedirect'

const HSTS = 'max-age=31536000; includeSubDomains'

export default {
  async fetch(request, env, ctx) {
    // Retired free addresses (medoflow.pages.dev, *.workers.dev) 308 to medoflow.com.
    // No-op until LEGACY_ROOT_DOMAINS is set, so this is harmless before cut-over.
    const moved = retiredHostRedirect(request.url, env)
    if (moved) return moved

    const url = new URL(request.url)
    if (url.protocol === 'http:') {
      if (request.method === 'GET' || request.method === 'HEAD') {
        url.protocol = 'https:'
        return Response.redirect(url.toString(), 301)
      }
      return new Response('HTTPS required', { status: 403 })
    }
    const response = await handler.fetch(request, env, ctx)
    const secured = new Response(response.body, response)
    secured.headers.set('strict-transport-security', HSTS)
    return secured
  },
}

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js'
