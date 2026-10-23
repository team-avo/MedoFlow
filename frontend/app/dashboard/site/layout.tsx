/**
 * Website builder (Component 8): overview, editor, templates, images,
 * domains, redirects and enquiries share this shell. The site stylesheet is
 * loaded so the editor canvas and template previews render exactly like the
 * live site.
 */
import '@/components/site/site.css'
import { BuilderNav } from '@/components/site/builder/BuilderNav'

export default function SiteBuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 lg:px-8">
      <BuilderNav />
      {children}
    </div>
  )
}
