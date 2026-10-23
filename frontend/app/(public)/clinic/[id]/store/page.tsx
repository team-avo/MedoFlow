/** First-builder URL /clinic/<idOrSlug>/store → the site's /store (Component 8). */
import { headers } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import { legacyClinicTarget } from '@/lib/site/legacyRedirect'

export default async function LegacyClinicStorePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  permanentRedirect(legacyClinicTarget((await headers()).get('host'), id, '/store'))
}
