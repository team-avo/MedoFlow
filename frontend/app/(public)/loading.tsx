import { MedoflowFullScreen } from '@/components/common/MedoflowLoader'

// Per-area loading screen. Deliberately not at app/loading.tsx: a root
// boundary would also wrap clinic websites (app/clinic-site), streaming them
// with a MedoFlow loader and a fixed 200 status — clinic sites need real
// 404 / 301 responses and their own branding (Component 8).
export default function AreaLoading() {
  return <MedoflowFullScreen subtitle="Loading clinical OS" />
}
