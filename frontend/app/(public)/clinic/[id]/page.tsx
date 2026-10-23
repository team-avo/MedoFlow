/**
 * First-builder URL /clinic/<idOrSlug>. The clinic website now lives at its
 * own host (or /s/<slug> on the app host) — Component 8. Old links keep
 * working through a permanent redirect.
 */
import { headers } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import { legacyClinicTarget } from '@/lib/site/legacyRedirect'

export default async function LegacyClinicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  permanentRedirect(legacyClinicTarget((await headers()).get('host'), id, '/'))
}
