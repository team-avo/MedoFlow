'use client'

import * as React from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Upload, X, Check } from 'lucide-react'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

const PRESET_COLORS = [
  '#6366f1', // indigo (default)
  '#0D9488', // teal (brand)
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#ef4444', // red
  '#10b981', // emerald
] as const

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
const MAX_SIZE_BYTES = 2 * 1024 * 1024 // 2 MB

export default function BrandStepPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [logoDataUrl, setLogoDataUrl] = React.useState<string | null>(null)
  const [logoError, setLogoError] = React.useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = React.useState('#6366f1')
  const [isSaving, setIsSaving] = React.useState(false)

  // Fetch current brand on mount so resume works
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/onboarding/status')
        const brand = data?.data?.brand
        if (!cancelled && brand) {
          if (brand.primaryColor) setPrimaryColor(brand.primaryColor)
          if (brand.logoUrl) setLogoDataUrl(brand.logoUrl)
        }
      } catch (err) {
        // OK to ignore — user will just fill from scratch
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleFile = (file: File) => {
    setLogoError(null)
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLogoError('Please choose a PNG, JPG, SVG, or WebP file.')
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setLogoError('Logo must be 2 MB or less.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setLogoDataUrl(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const clinicName = user?.clinic?.name ?? 'Your Clinic'

  return (
    <OnboardingShell
      stepKey="brand"
      title="Brand your clinic"
      subtitle="Upload a logo and pick a primary color. You can change this anytime from Settings."
      nextLabel="Save & continue"
      onNext={async () => {
        setIsSaving(true)
        try {
          await api.patch('/onboarding/brand', {
            primaryColor,
            logoUrl: logoDataUrl,
          })
          await api.patch('/onboarding/step', { step: 2 })
          router.push('/locations')
        } finally {
          setIsSaving(false)
        }
      }}
      nextDisabled={loading || isSaving}
    >
      {loading ? (
        <LoadingSkeleton variant="card" />
      ) : (
        <>
          <div className="grid gap-8 md:grid-cols-2">
            {/* Logo uploader */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Clinic logo</label>
              <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50/30">
                {logoDataUrl ? (
                  <div className="relative mx-auto inline-block">
                    <Image
                      src={logoDataUrl}
                      alt="Logo preview"
                      width={160}
                      height={160}
                      unoptimized
                      className="mx-auto max-h-40 w-auto object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setLogoDataUrl(null)}
                      className="absolute -right-2 -top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white shadow hover:bg-slate-700"
                      aria-label="Remove logo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center justify-center py-6">
                    <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                      <Upload className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium text-slate-700">
                      Drop a file or click to upload
                    </p>
                    <p className="mt-1 text-xs text-slate-500">PNG, JPG, SVG, WebP · up to 2 MB</p>
                    <input
                      type="file"
                      accept={ACCEPTED_TYPES.join(',')}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFile(file)
                      }}
                    />
                  </label>
                )}
              </div>
              {logoError && <p className="mt-2 text-xs text-rose-600">{logoError}</p>}
            </div>

            {/* Color picker + preview */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Primary color</label>
              <div className="grid grid-cols-8 gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPrimaryColor(c)}
                    className="group relative aspect-square rounded-xl"
                    style={{ backgroundColor: c }}
                    aria-label={`Pick ${c}`}
                  >
                    {primaryColor.toLowerCase() === c.toLowerCase() && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Check className="h-4 w-4 text-white drop-shadow" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                />
                <code className="rounded-md bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700">
                  {primaryColor}
                </code>
              </div>

              {/* Live preview card */}
              <div
                className="mt-6 rounded-2xl p-5 text-white shadow-md transition-colors"
                style={{ backgroundColor: primaryColor }}
              >
                <p className="text-xs font-semibold uppercase tracking-wider opacity-75">Preview</p>
                <div className="mt-2 flex items-center gap-3">
                  {logoDataUrl ? (
                    <Image
                      src={logoDataUrl}
                      alt=""
                      width={36}
                      height={36}
                      unoptimized
                      className="h-9 w-9 rounded-lg bg-white/20 object-contain p-1"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20 text-sm font-bold">
                      {clinicName.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="font-semibold">{clinicName}</p>
                    <p className="text-xs opacity-80">Book your next visit</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </OnboardingShell>
  )
}
