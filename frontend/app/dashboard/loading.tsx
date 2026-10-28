import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

// Scoped to the dashboard subtree so the sidebar and top bar stay put; only
// the content area shows a page-shaped skeleton while the route loads.
export default function DashboardLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10"
      role="status"
      aria-label="Loading"
    >
      <LoadingSkeleton variant="page" />
    </div>
  )
}
