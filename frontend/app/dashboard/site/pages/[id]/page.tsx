/** The first builder's page editor moved to /dashboard/site/editor (Component 8). */
import { redirect } from 'next/navigation'

export default async function LegacyPageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/dashboard/site/editor?page=${encodeURIComponent(id)}`)
}
