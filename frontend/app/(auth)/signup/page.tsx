/**
 * Legacy /signup entrypoint — the full-page signup was replaced by the
 * <AuthModal> flow on the landing page. This page server-redirects to
 * `/?auth=signup` so the modal opens.
 */

import { redirect } from 'next/navigation'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ returnUrl?: string }>
}) {
  const { returnUrl } = await searchParams
  const qs = new URLSearchParams({ auth: 'signup' })
  if (returnUrl) qs.set('returnUrl', returnUrl)
  redirect(`/?${qs.toString()}`)
}
