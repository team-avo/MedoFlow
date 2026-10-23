'use client'

/** Website image library (F8.5). */
import { MediaLibrary } from '@/components/site/builder/MediaLibrary'

export default function SiteMediaPage() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold text-slate-900">Images</h1>
      <p className="mb-5 mt-1 text-sm text-slate-600">
        Logos, photos and banners for your website. Images are public once used on your site — never
        upload patient photos or documents here.
      </p>
      <MediaLibrary />
    </div>
  )
}
