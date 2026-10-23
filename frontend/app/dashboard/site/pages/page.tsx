/** The first builder's page list moved to the website overview (Component 8). */
import { redirect } from 'next/navigation'

export default function LegacyPagesList() {
  redirect('/dashboard/site')
}
