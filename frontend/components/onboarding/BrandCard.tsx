'use client'

/**
 * Logo and brand colours (CTO-27). Upload a logo (PNG, JPEG or SVG; an SVG is
 * sanitised first) and MedoFlow proposes a primary and a secondary colour
 * from it, in the browser, adjusted to pass WCAG AA. Preview them, use them,
 * or pick your own. Saving updates the website's draft theme (live once you
 * publish) and the console accent (CTO-28).
 */
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Palette, Upload } from 'lucide-react'
import { onboardingApi } from '@/lib/onboardingApi'
import {
  paletteFromImage,
  proposeBrandColors,
  readableAccent,
  sanitizeSvg,
} from '@/lib/brandColors'
import { useAuth } from '@/contexts/AuthContext'
import { useAppToast } from '@/hooks/useAppToast'
import { apiErrorOf } from '@/lib/apiError'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/svg+xml']
const MAX_BYTES = 2 * 1024 * 1024

const readAsText = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsText(f)
  })
const readAsDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })

export function BrandCard() {
  const toast = useAppToast()
  const qc = useQueryClient()
  const { refetchUser } = useAuth()
  const { data: status } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: onboardingApi.getStatus,
  })
  const brand = status?.brand
  const [logo, setLogo] = React.useState<string | null>(null)
  const [primary, setPrimary] = React.useState('#0d9488')
  const [secondary, setSecondary] = React.useState('#14b8a6')
  const [proposal, setProposal] = React.useState<{ primary: string; secondary: string } | null>(
    null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const loaded = React.useRef(false)

  React.useEffect(() => {
    if (loaded.current || !brand) return
    loaded.current = true
    setLogo(brand.logoUrl)
    setPrimary(brand.primaryColor)
    if (brand.secondaryColor) setSecondary(brand.secondaryColor)
  }, [brand])

  const onFile = async (file: File) => {
    setError(null)
    if (!ACCEPTED.includes(file.type)) return setError('Choose a PNG, JPEG or SVG file.')
    if (file.size > MAX_BYTES) return setError('The logo must be 2 MB or smaller.')
    let dataUrl: string
    if (file.type === 'image/svg+xml') {
      const clean = sanitizeSvg(await readAsText(file))
      if (!clean) return setError('That SVG could not be read.')
      dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(clean)))}`
    } else {
      dataUrl = await readAsDataUrl(file)
    }
    setLogo(dataUrl)
    try {
      const proposed = proposeBrandColors(await paletteFromImage(dataUrl))
      setProposal(proposed ? { primary: proposed.primary, secondary: proposed.secondary } : null)
      if (!proposed) setError('We could not find a brand colour in this logo. Pick one below.')
    } catch {
      setProposal(null)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await onboardingApi.saveBrand({
        primaryColor: primary,
        secondaryColor: secondary,
        logoUrl: logo,
      })
      await qc.invalidateQueries({ queryKey: ['onboarding', 'status'] })
      await refetchUser() // the console accent follows (CTO-28)
      toast.success('Brand saved. Your website draft and dashboard use it now.')
    } catch (err) {
      toast.error(apiErrorOf(err).message)
    } finally {
      setSaving(false)
    }
  }

  const preview = readableAccent(primary)

  return (
    <section
      id="brand"
      aria-label="Logo and colours"
      className="space-y-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm md:p-8"
    >
      <div className="flex items-center gap-2">
        <Palette className="h-5 w-5 text-brand" />
        <h2 className="text-base font-semibold text-slate-900">Logo and colours</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 p-6 text-sm text-slate-600 hover:border-brand">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="Your logo" className="max-h-24 w-auto object-contain" />
            ) : (
              <Upload className="h-6 w-6 text-slate-400" />
            )}
            <span>{logo ? 'Change logo' : 'Upload your logo (PNG, JPEG or SVG)'}</span>
            <input
              type="file"
              accept={ACCEPTED.join(',')}
              className="sr-only"
              aria-label="Upload logo"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
            />
          </label>
          {error && <p className="text-xs text-amber-700">{error}</p>}
          {proposal && (
            <div className="rounded-xl bg-slate-50 p-3" data-testid="brand-proposal">
              <p className="text-xs font-semibold text-slate-700">From your logo</p>
              <div className="mt-2 flex items-center gap-3">
                {[proposal.primary, proposal.secondary].map((c) => (
                  <span key={c} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span
                      className="h-6 w-6 rounded-md ring-1 ring-slate-200"
                      style={{ backgroundColor: c }}
                    />
                    {c}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setPrimary(proposal.primary)
                    setSecondary(proposal.secondary)
                  }}
                  className="ml-auto rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-100"
                >
                  Use these
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-3">
          {(
            [
              ['Primary colour', primary, setPrimary, 'brand-primary'],
              ['Secondary colour', secondary, setSecondary, 'brand-secondary'],
            ] as const
          ).map(([label, value, set, id]) => (
            <div key={id} className="flex items-center gap-3">
              <input
                id={id}
                type="color"
                value={value}
                onChange={(e) => set(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-slate-200"
              />
              <label htmlFor={id} className="text-sm text-slate-700">
                {label} <span className="font-mono text-xs text-slate-500">{value}</span>
              </label>
            </div>
          ))}
          <div className="rounded-xl border border-slate-100 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">Preview</p>
            <span
              className="inline-flex rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{ backgroundColor: preview.accent, color: preview.foreground }}
              data-testid="brand-preview"
            >
              Book appointment
            </span>
            {preview.accent !== primary.toLowerCase() && (
              <p className="mt-2 text-xs text-slate-500">
                Buttons use a slightly darker {preview.accent} so their text stays readable.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-strong disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save brand'}
          </button>
        </div>
      </div>
    </section>
  )
}
