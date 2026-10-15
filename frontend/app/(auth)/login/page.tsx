/**
 * Legacy /login entrypoint — the full-page login was replaced by the
 * <AuthModal> flow on the landing page. This page server-redirects to
 * `/?auth=login` so the modal opens, forwarding any `returnUrl` that
 * emails, bookmarks, or auth guards may have included.
 */

import { redirect } from 'next/navigation'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnUrl?: string }>
}) {
  const { returnUrl } = await searchParams
  const qs = new URLSearchParams({ auth: 'login' })
  if (returnUrl) qs.set('returnUrl', returnUrl)
  redirect(`/?${qs.toString()}`)
}
