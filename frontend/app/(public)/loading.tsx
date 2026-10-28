import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

// Per-area loading screen. Deliberately not at app/loading.tsx: a root
// boundary would also wrap clinic websites (app/clinic-site), streaming them
// with a MedoFlow loader and a fixed 200 status — clinic sites need real
// 404 / 301 responses and their own branding (Component 8).
// A page-shaped skeleton in place, not a full-screen takeover: the top
// progress bar (TopProgressBar) already says something is loading.
export default function AreaLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8"
      role="status"
      aria-label="Loading"
    >
      <LoadingSkeleton variant="page" />
    </div>
  )
}
