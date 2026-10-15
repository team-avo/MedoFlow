'use client'

/**
 * AI Website Builder — 2-step modal
 *
 * Step 1  — Logo upload + brand name + section pill picker.
 *            Logo drives automatic color extraction (no manual picker).
 * Step 2  — Full-page inline editor: every selected section is rendered as a
 *            card with its schema-driven fields editable in place.
 *            No drag-drop reordering (by design, keep it simple).
 *
 * Both "Generate Website" (create) and "Edit branding" (edit) use the same
 * two-step flow so the clinic owner always sees and edits the sections.
 */

import React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Sparkles,
  X,
  Wand2,
  Check,
  ExternalLink,
  ImageIcon,
  Trash2,
  ArrowLeft,
  Globe,
  Layout,
  LayoutGrid,
  Users,
  Star,
  HelpCircle,
  CalendarCheck,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  generateClinicWebsite,
  aiBootstrapWebsite,
  saveSitePageDraft,
  publishSitePage,
  type GenerateWebsiteResult,
  type BootstrappedSection,
} from '@/lib/clinicApi'
import { SECTIONS, SECTION_BY_TYPE, type SectionField } from '@/lib/siteSections'

// ─── Section options shown as pills in Step 1 ──────────────────────────────

const SECTION_OPTIONS: Array<{
  type: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  defaultSelected: boolean
}> = [
  {
    type: 'hero',
    label: 'Hero Banner',
    description: 'Headline + booking CTA at the top',
    icon: Layout,
    defaultSelected: true,
  },
  {
    type: 'service-grid',
    label: 'Services',
    description: 'Service catalog from your clinic',
    icon: LayoutGrid,
    defaultSelected: true,
  },
  {
    type: 'provider-bios',
    label: 'Our Team',
    description: 'Clinician photos and bios',
    icon: Users,
    defaultSelected: false,
  },
  {
    type: 'testimonials',
    label: 'Patient Reviews',
    description: 'Quotes from happy patients',
    icon: Star,
    defaultSelected: false,
  },
  {
    type: 'faq',
    label: 'FAQ',
    description: 'Common questions and answers',
    icon: HelpCircle,
    defaultSelected: false,
  },
  {
    type: 'booking-cta',
    label: 'Booking Banner',
    description: 'Bottom-page call to action',
    icon: CalendarCheck,
    defaultSelected: true,
  },
]

const DEFAULT_THEME = '#0D9488'

// ─── Logo → color extraction ───────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function extractPaletteFromImage(src: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const W = 64
        const H = 64
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve([])
          return
        }
        ctx.drawImage(img, 0, 0, W, H)
        const data = ctx.getImageData(0, 0, W, H).data
        const buckets = new Map<string, { r: number; g: number; b: number; n: number }>()
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] ?? 0
          const g = data[i + 1] ?? 0
          const b = data[i + 2] ?? 0
          const a = data[i + 3] ?? 0
          if (a < 200) continue
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          if (max > 240 && min > 240) continue
          if (max < 30) continue
          if (max - min < 25) continue
          const key = `${r >> 4}-${g >> 4}-${b >> 4}`
          const prev = buckets.get(key)
          if (prev) {
            prev.r += r
            prev.g += g
            prev.b += b
            prev.n += 1
          } else {
            buckets.set(key, { r, g, b, n: 1 })
          }
        }
        const top = Array.from(buckets.values())
          .sort((a, b) => b.n - a.n)
          .slice(0, 4)
          .map((c) => {
            const r = Math.round(c.r / c.n)
            const g = Math.round(c.g / c.n)
            const b = Math.round(c.b / c.n)
            return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
          })
        resolve(top)
      } catch {
        resolve([])
      }
    }
    img.onerror = () => resolve([])
    img.src = src
  })
}

// ─── Public component ─────────────────────────────────────────────────────

type ModalStep = 'form' | 'generating' | 'editor' | 'publishing' | 'done'

export function WebsiteGeneratorModal({
  open,
  onOpenChange,
  mode = 'create',
  defaultName = '',
  defaultLogoUrl,
  defaultThemeColor,
  onGenerated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  mode?: 'create' | 'edit'
  defaultName?: string
  defaultLogoUrl?: string
  defaultThemeColor?: string
  onGenerated?: (result: GenerateWebsiteResult) => void
}) {
  const [step, setStep] = React.useState<ModalStep>('form')

  // Step 1 state
  const [name, setName] = React.useState(defaultName)
  const [logoUrl, setLogoUrl] = React.useState(defaultLogoUrl ?? '')
  const [themeColor, setThemeColor] = React.useState(defaultThemeColor ?? DEFAULT_THEME)
  const [extractedColors, setExtractedColors] = React.useState<string[]>([])
  const [extracting, setExtracting] = React.useState(false)
  const [dragActive, setDragActive] = React.useState(false)
  const [selectedSections, setSelectedSections] = React.useState<string[]>(
    SECTION_OPTIONS.filter((s) => s.defaultSelected).map((s) => s.type)
  )
  const [step1Error, setStep1Error] = React.useState<string | null>(null)

  // Step 2 state
  const [pageId, setPageId] = React.useState<string | null>(null)
  const [sections, setSections] = React.useState<BootstrappedSection[]>([])
  const [expandedSection, setExpandedSection] = React.useState<string | null>(null)
  const [publishError, setPublishError] = React.useState<string | null>(null)

  // Done state
  const [websiteUrl, setWebsiteUrl] = React.useState<string | null>(null)

  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  // Track previous open value so we only reset on false → true transition,
  // not when parent props update mid-flow (e.g. after generateClinicWebsite
  // triggers a parent refetch that changes defaultLogoUrl / defaultThemeColor).
  const prevOpenRef = React.useRef(false)

  // ── Reset on open (only on closed → open transition) ──────────────────
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      setStep('form')
      setName(defaultName)
      setLogoUrl(defaultLogoUrl ?? '')
      setThemeColor(defaultThemeColor ?? DEFAULT_THEME)
      setExtractedColors([])
      setExtracting(false)
      setSelectedSections(SECTION_OPTIONS.filter((s) => s.defaultSelected).map((s) => s.type))
      setStep1Error(null)
      setPageId(null)
      setSections([])
      setExpandedSection(null)
      setPublishError(null)
      setWebsiteUrl(null)
    }
    prevOpenRef.current = open
  }, [open, defaultName, defaultLogoUrl, defaultThemeColor])

  // ── Color extraction from logo ─────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false
    if (!logoUrl) {
      setExtractedColors([])
      return
    }
    setExtracting(true)
    extractPaletteFromImage(logoUrl).then((palette) => {
      if (cancelled) return
      setExtractedColors(palette)
      if (palette[0]) setThemeColor(palette[0].toUpperCase())
      setExtracting(false)
    })
    return () => {
      cancelled = true
    }
  }, [logoUrl])

  // ── File handling ──────────────────────────────────────────────────────
  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setStep1Error('Logo must be an image file')
      return
    }
    if (file.size > 2_000_000) {
      setStep1Error('Logo must be under 2 MB')
      return
    }
    try {
      const dataUrl = await fileToDataUrl(file)
      setLogoUrl(dataUrl)
      setStep1Error(null)
    } catch {
      setStep1Error('Could not read that file')
    }
  }

  // ── Section toggle ─────────────────────────────────────────────────────
  const toggleSection = (type: string) => {
    setSelectedSections((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    )
  }

  // ── Step 1 → Generate ─────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!name.trim()) {
      setStep1Error('Clinic name is required')
      return
    }
    if (selectedSections.length === 0) {
      setStep1Error('Select at least one section')
      return
    }
    setStep1Error(null)
    setStep('generating')

    try {
      // Update clinic branding + generate AI sections in parallel
      const [brandResult, bootstrapResult] = await Promise.all([
        generateClinicWebsite({
          name: name.trim(),
          logoUrl: logoUrl.trim() || undefined,
          themeColor: themeColor || undefined,
        }),
        aiBootstrapWebsite({
          name: name.trim(),
          logoUrl: logoUrl.trim() || null,
          themeColor: themeColor || null,
          sectionTypes: selectedSections,
        }),
      ])

      setWebsiteUrl(brandResult.websiteUrl)
      setPageId(bootstrapResult.pageId)
      setSections(bootstrapResult.sections)
      // Auto-expand first section
      setExpandedSection(bootstrapResult.sections[0]?.id ?? null)
      onGenerated?.(brandResult)
      setStep('editor')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not generate website — please try again'
      setStep1Error(msg)
      setStep('form')
    }
  }

  // ── Step 2 → Publish ─────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!pageId) return
    setPublishError(null)
    setStep('publishing')
    try {
      await saveSitePageDraft(pageId, sections)
      await publishSitePage(pageId)
      setStep('done')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not publish page'
      setPublishError(msg)
      setStep('editor')
    }
  }

  // ── Section settings update ────────────────────────────────────────────
  const updateSectionSetting = (sectionId: string, key: string, value: unknown) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, settings: { ...s.settings, [key]: value } } : s
      )
    )
  }

  // ── Dialog sizing per step ─────────────────────────────────────────────
  const contentClass = cn(
    'fixed left-1/2 top-1/2 z-[61] -translate-x-1/2 -translate-y-1/2',
    'overflow-hidden rounded-[28px] bg-white shadow-2xl',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
    'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
    step === 'editor' ? 'w-[96vw] max-w-3xl max-h-[92vh] flex flex-col' : 'w-[96vw] max-w-[520px]'
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content className={contentClass}>
          {/* ── Step 1: Form ──────────────────────────────────────────────── */}
          {step === 'form' && (
            <Step1Form
              name={name}
              logoUrl={logoUrl}
              themeColor={themeColor}
              extractedColors={extractedColors}
              extracting={extracting}
              dragActive={dragActive}
              selectedSections={selectedSections}
              error={step1Error}
              isEdit={mode === 'edit'}
              fileInputRef={fileInputRef}
              onNameChange={setName}
              onLogoRemove={() => {
                setLogoUrl('')
                setExtractedColors([])
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragActive(false)
                handleFile(e.dataTransfer.files?.[0])
              }}
              onBrowse={() => fileInputRef.current?.click()}
              onFileChange={(e) => handleFile(e.target.files?.[0] ?? undefined)}
              onColorSelect={setThemeColor}
              onSectionToggle={toggleSection}
              onSubmit={handleGenerate}
              onClose={() => onOpenChange(false)}
            />
          )}

          {/* ── Generating ────────────────────────────────────────────────── */}
          {step === 'generating' && <GeneratingSpinner clinicName={name} themeColor={themeColor} />}

          {/* ── Step 2: Inline editor ─────────────────────────────────────── */}
          {step === 'editor' && (
            <Step2Editor
              clinicName={name}
              themeColor={themeColor}
              sections={sections}
              expandedSection={expandedSection}
              publishError={publishError}
              websiteUrl={websiteUrl}
              onExpandToggle={(id) => setExpandedSection((prev) => (prev === id ? null : id))}
              onSettingChange={updateSectionSetting}
              onBack={() => setStep('form')}
              onPublish={handlePublish}
            />
          )}

          {/* ── Publishing ────────────────────────────────────────────────── */}
          {step === 'publishing' && <PublishingSpinner themeColor={themeColor} />}

          {/* ── Done ─────────────────────────────────────────────────────── */}
          {step === 'done' && websiteUrl && (
            <DoneState
              clinicName={name}
              websiteUrl={websiteUrl}
              themeColor={themeColor}
              isEdit={mode === 'edit'}
              onClose={() => onOpenChange(false)}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ─── Step 1 form ──────────────────────────────────────────────────────────

function Step1Form({
  name,
  logoUrl,
  themeColor,
  extractedColors,
  extracting,
  dragActive,
  selectedSections,
  error,
  isEdit,
  fileInputRef,
  onNameChange,
  onLogoRemove,
  onDragOver,
  onDragLeave,
  onDrop,
  onBrowse,
  onFileChange,
  onColorSelect,
  onSectionToggle,
  onSubmit,
  onClose,
}: {
  name: string
  logoUrl: string
  themeColor: string
  extractedColors: string[]
  extracting: boolean
  dragActive: boolean
  selectedSections: string[]
  error: string | null
  isEdit: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onNameChange: (v: string) => void
  onLogoRemove: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onBrowse: () => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onColorSelect: (c: string) => void
  onSectionToggle: (type: string) => void
  onSubmit: () => void
  onClose: () => void
}) {
  const accent = themeColor || DEFAULT_THEME

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-7 pt-7 pb-5">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
            style={{ backgroundColor: accent }}
          >
            {isEdit ? <Wand2 className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          </div>
          <div>
            <DialogPrimitive.Title className="text-[17px] font-bold text-slate-900 leading-tight">
              {isEdit ? 'Rebuild your patient site' : 'Build your patient site'}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-0.5 text-[13px] text-slate-500">
              Upload your logo · pick sections · AI writes the copy
            </DialogPrimitive.Description>
          </div>
        </div>
        <DialogPrimitive.Close
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </div>

      <div className="flex flex-col gap-5 px-7 pb-7">
        {/* Logo upload — first and prominent */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Logo{' '}
              <span className="normal-case font-normal text-slate-300">
                — sets your brand colour automatically
              </span>
            </label>
            {logoUrl && (
              <button
                type="button"
                onClick={onLogoRemove}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-rose-500 transition-colors"
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            )}
          </div>

          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={onBrowse}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onBrowse()}
            className={cn(
              'flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed px-5 py-4 transition-all',
              dragActive
                ? 'border-slate-400 bg-slate-100'
                : logoUrl
                  ? 'border-slate-200 bg-white hover:border-slate-300'
                  : 'border-slate-200 bg-slate-50 hover:border-indigo-200 hover:bg-indigo-50/30'
            )}
          >
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFileChange} />
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Logo preview"
                className="h-16 w-16 shrink-0 rounded-xl border border-slate-100 object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm border border-slate-100">
                <ImageIcon className="h-6 w-6 text-slate-300" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-slate-700">
                {logoUrl ? 'Logo uploaded' : 'Drop your logo or click to browse'}
              </p>
              <p className="text-[12px] text-slate-400">
                {extracting ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Extracting brand colours…
                  </span>
                ) : extractedColors.length > 0 ? (
                  <span className="flex items-center gap-2">
                    <span className="text-teal-600 font-semibold">✓ Colours extracted</span>
                    <span className="flex gap-1">
                      {extractedColors.slice(0, 4).map((c) => (
                        <span
                          key={c}
                          className="inline-block h-3.5 w-3.5 rounded-full border border-white shadow-sm cursor-pointer ring-2 ring-transparent hover:ring-slate-300 transition-all"
                          style={{
                            backgroundColor: c,
                            outline:
                              themeColor.toLowerCase() === c.toLowerCase()
                                ? '2px solid #1e293b'
                                : undefined,
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onColorSelect(c.toUpperCase())
                          }}
                          title={c}
                        />
                      ))}
                    </span>
                  </span>
                ) : (
                  'PNG · JPG · SVG · max 2 MB'
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Clinic name */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Clinic name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Everwell Medical"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] font-medium text-slate-900 outline-none transition-all placeholder:text-slate-300 focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100"
          />
        </div>

        {/* Section picker */}
        <div className="space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Sections to include
          </label>
          <div className="flex flex-wrap gap-2">
            {SECTION_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const selected = selectedSections.includes(opt.type)
              return (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => onSectionToggle(opt.type)}
                  title={opt.description}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-all',
                    selected
                      ? 'border-transparent text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  )}
                  style={selected ? { backgroundColor: accent } : undefined}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {opt.label}
                  {selected && <Check className="h-3 w-3 shrink-0 opacity-80" />}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-400">
            {selectedSections.length} section{selectedSections.length !== 1 ? 's' : ''} selected ·
            AI will write the copy for each
          </p>
        </div>

        {error && (
          <p className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={selectedSections.length === 0 || !name.trim()}
          className={cn(
            'inline-flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-bold text-white shadow-sm transition-opacity',
            selectedSections.length === 0 || !name.trim()
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:opacity-90'
          )}
          style={{ backgroundColor: accent }}
        >
          <Sparkles className="h-4 w-4" />
          Generate my site
        </button>
      </div>
    </div>
  )
}

// ─── Generating spinner ────────────────────────────────────────────────────

function GeneratingSpinner({ clinicName, themeColor }: { clinicName: string; themeColor: string }) {
  const accent = themeColor || DEFAULT_THEME
  const [dotCount, setDotCount] = React.useState(1)
  React.useEffect(() => {
    const t = setInterval(() => setDotCount((n) => (n % 3) + 1), 500)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex flex-col items-center justify-center gap-5 px-10 py-16">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg"
        style={{ backgroundColor: accent }}
      >
        <Sparkles className="h-7 w-7 animate-pulse" />
      </div>
      <div className="text-center">
        <p className="text-[17px] font-bold text-slate-900">
          AI is writing your site{'.'.repeat(dotCount)}
        </p>
        <p className="mt-1 text-[13px] text-slate-500">
          Crafting copy for <span className="font-semibold">{clinicName}</span> — usually takes 5–15
          seconds
        </p>
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full animate-bounce"
            style={{ backgroundColor: accent, animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Step 2 inline editor ─────────────────────────────────────────────────

function Step2Editor({
  clinicName,
  themeColor,
  sections,
  expandedSection,
  publishError,
  websiteUrl,
  onExpandToggle,
  onSettingChange,
  onBack,
  onPublish,
}: {
  clinicName: string
  themeColor: string
  sections: BootstrappedSection[]
  expandedSection: string | null
  publishError: string | null
  websiteUrl: string | null
  onExpandToggle: (id: string) => void
  onSettingChange: (sectionId: string, key: string, value: unknown) => void
  onBack: () => void
  onPublish: () => void
}) {
  const accent = themeColor || DEFAULT_THEME

  return (
    <>
      {/* Sticky header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex min-w-0 flex-col items-center">
          <DialogPrimitive.Title className="text-[14px] font-bold text-slate-800 truncate max-w-[180px]">
            {clinicName}
          </DialogPrimitive.Title>
          <p className="text-[11px] text-slate-400">Review & edit your site copy</p>
        </div>

        <button
          type="button"
          onClick={onPublish}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <Globe className="h-3.5 w-3.5" />
          Publish site
        </button>
      </div>

      {/* Scrollable section cards */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        {publishError && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">
            {publishError}
          </div>
        )}

        <p className="text-[12px] text-slate-400 mb-1">
          AI has written copy for each section below. Edit any field, then click{' '}
          <span className="font-semibold text-slate-600">Publish site</span> when ready.
        </p>

        {sections.map((section) => {
          const def = SECTION_BY_TYPE[section.type]
          if (!def) return null
          const isOpen = expandedSection === section.id
          return (
            <SectionCard
              key={section.id}
              section={section}
              def={def}
              isOpen={isOpen}
              accent={accent}
              onToggle={() => onExpandToggle(section.id ?? section.type)}
              onSettingChange={(key, val) => onSettingChange(section.id ?? section.type, key, val)}
            />
          )
        })}
      </div>

      {/* Footer hint */}
      {websiteUrl && (
        <div className="shrink-0 border-t border-slate-100 px-6 py-3 text-center">
          <p className="text-[11px] text-slate-400">
            Your site will be live at{' '}
            <code className="font-mono text-slate-600">
              {typeof window !== 'undefined' ? window.location.origin : ''}
              {websiteUrl}
            </code>
          </p>
        </div>
      )}
    </>
  )
}

// ─── Section card (collapsible) ───────────────────────────────────────────

function SectionCard({
  section,
  def,
  isOpen,
  accent,
  onToggle,
  onSettingChange,
}: {
  section: BootstrappedSection
  def: (typeof SECTIONS)[number]
  isOpen: boolean
  accent: string
  onToggle: () => void
  onSettingChange: (key: string, value: unknown) => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {/* Card header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: accent }}
          />
          <span className="text-[14px] font-bold text-slate-800">{def.label}</span>
          <span className="hidden sm:inline text-[12px] text-slate-400">{def.description}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        )}
      </button>

      {/* Editable fields */}
      {isOpen && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-4">
          {def.fields
            .filter((f) => !['ctaHref', 'backgroundImage'].includes(f.key))
            .map((field) => (
              <FieldEditor
                key={field.key}
                field={field}
                value={section.settings[field.key]}
                accent={accent}
                onChange={(val) => onSettingChange(field.key, val)}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// ─── Field editor ─────────────────────────────────────────────────────────

function FieldEditor({
  field,
  value,
  accent,
  onChange,
}: {
  field: SectionField
  value: unknown
  accent: string
  onChange: (value: unknown) => void
}) {
  const strVal = typeof value === 'string' ? value : value !== undefined ? String(value) : ''
  const numVal = typeof value === 'number' ? value : Number(strVal) || 0
  const arrVal = Array.isArray(value) ? value.map(String) : strVal.split('\n').filter(Boolean)

  const labelClass = 'text-[11px] font-bold uppercase tracking-widest text-slate-400'
  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-900 outline-none transition-all focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100 resize-none'

  if (field.type === 'string') {
    return (
      <div className="space-y-1.5">
        <label className={labelClass}>{field.label}</label>
        <input
          type="text"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder={`Enter ${field.label.toLowerCase()}…`}
        />
        {field.hint && <p className="text-[11px] text-slate-400">{field.hint}</p>}
      </div>
    )
  }

  if (field.type === 'longtext') {
    return (
      <div className="space-y-1.5">
        <label className={labelClass}>{field.label}</label>
        <textarea
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder={`Enter ${field.label.toLowerCase()}…`}
        />
        {field.hint && <p className="text-[11px] text-slate-400">{field.hint}</p>}
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div className="space-y-1.5">
        <label className={labelClass}>{field.label}</label>
        <input
          type="number"
          value={numVal}
          onChange={(e) => onChange(Number(e.target.value))}
          className={inputClass}
        />
        {field.hint && <p className="text-[11px] text-slate-400">{field.hint}</p>}
      </div>
    )
  }

  if (field.type === 'boolean') {
    return (
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-teal-600"
        />
        <span className="text-[13px] font-semibold text-slate-700">{field.label}</span>
      </label>
    )
  }

  if (field.type === 'image-url') {
    return (
      <div className="space-y-1.5">
        <label className={labelClass}>{field.label}</label>
        {strVal && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={strVal}
            alt="Preview"
            className="h-24 w-full rounded-xl object-cover border border-slate-200"
          />
        )}
        <input
          type="url"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          className={inputClass}
        />
        {field.hint && <p className="text-[11px] text-slate-400">{field.hint}</p>}
      </div>
    )
  }

  if (field.type === 'string-list') {
    return (
      <div className="space-y-1.5">
        <label className={labelClass}>{field.label}</label>
        <textarea
          value={arrVal.join('\n')}
          onChange={(e) => onChange(e.target.value.split('\n'))}
          rows={Math.max(3, arrVal.length + 1)}
          className={`${inputClass} font-mono text-[12px]`}
          placeholder="One item per line…"
        />
        {field.hint && <p className="text-[11px] text-slate-400">{field.hint}</p>}
      </div>
    )
  }

  if (field.type === 'color') {
    return (
      <div className="space-y-1.5">
        <label className={labelClass}>{field.label}</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={strVal || accent}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-10 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5"
          />
          <input
            type="text"
            value={strVal || accent}
            onChange={(e) => onChange(e.target.value)}
            className="w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[12px] text-slate-700 outline-none focus:border-slate-400 focus:bg-white"
          />
        </div>
      </div>
    )
  }

  return null
}

// ─── Publishing spinner ───────────────────────────────────────────────────

function PublishingSpinner({ themeColor }: { themeColor: string }) {
  const accent = themeColor || DEFAULT_THEME
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-10 py-14">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg"
        style={{ backgroundColor: accent }}
      >
        <Globe className="h-6 w-6 animate-pulse" />
      </div>
      <div className="text-center">
        <p className="text-base font-bold text-slate-900">Publishing your site…</p>
        <p className="mt-1 text-[13px] text-slate-500">Making it live for your patients</p>
      </div>
      <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
    </div>
  )
}

// ─── Done state ───────────────────────────────────────────────────────────

function DoneState({
  clinicName,
  websiteUrl,
  themeColor,
  isEdit,
  onClose,
}: {
  clinicName: string
  websiteUrl: string
  themeColor: string
  isEdit: boolean
  onClose: () => void
}) {
  const accent = themeColor || DEFAULT_THEME
  const fullUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${websiteUrl}`
  const [copied, setCopied] = React.useState(false)

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="p-8">
      <DialogPrimitive.Close
        aria-label="Close"
        className="absolute right-5 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>

      <div className="mb-6 flex items-start gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
          style={{ backgroundColor: accent }}
        >
          <Check className="h-6 w-6" />
        </div>
        <div>
          <DialogPrimitive.Title className="text-xl font-bold text-slate-900">
            {isEdit ? 'Site updated!' : 'Site is live!'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-[13px] text-slate-500">
            {clinicName} is now live and accepting bookings.
          </DialogPrimitive.Description>
        </div>
      </div>

      <div
        className="overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: `${accent}30`,
          background: `linear-gradient(135deg, ${accent}08, transparent)`,
        }}
      >
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Patient site URL
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-xl bg-white/80 px-3 py-2.5 font-mono text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
            {fullUrl}
          </code>
          <button
            type="button"
            onClick={copyUrl}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors',
              copied
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            )}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <a
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <ExternalLink className="h-4 w-4" />
          Visit site
        </a>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-[14px] font-bold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Done
        </button>
      </div>
    </div>
  )
}
