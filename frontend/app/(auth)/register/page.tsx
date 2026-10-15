/**
 * Legacy /register entrypoint — use /signup ? Same destination: the
 * <AuthModal> flow on the landing page. Server-redirects to
 * `/?auth=signup`.
 */

import { redirect } from 'next/navigation'

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ returnUrl?: string }>
}) {
  const { returnUrl } = await searchParams
  const qs = new URLSearchParams({ auth: 'signup' })
  if (returnUrl) qs.set('returnUrl', returnUrl)
  redirect(`/?${qs.toString()}`)
}
