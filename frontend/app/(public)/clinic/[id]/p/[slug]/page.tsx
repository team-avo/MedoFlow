/** First-builder URL /clinic/<idOrSlug>/p/<page> → the site's /<page> (Component 8). */
import { headers } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import { legacyClinicTarget } from '@/lib/site/legacyRedirect'

export default async function LegacyClinicSitePage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>
}) {
  const { id, slug } = await params
  const path = slug === 'home' ? '/' : `/${encodeURIComponent(slug)}`
  permanentRedirect(legacyClinicTarget((await headers()).get('host'), id, path))
}
