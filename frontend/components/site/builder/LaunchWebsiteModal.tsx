'use client'

/**
 * "Launch your website" (F8.3): template → brand → launch, from the admin
 * dashboard. Replaces the first builder's generator: the result is a full
 * multi-page site from a template, optionally with AI-written home copy.
 */
import React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, ExternalLink, ImagePlus, Loader2, Sparkles, X } from 'lucide-react'
import { siteApi, siteErrorMessage, type SiteAsset } from '@/lib/site/siteApi'
import { AppButton } from '@/components/ui-system'
import { cn } from '@/lib/utils'
import { Toggle, inputCls, Label } from './fields'
import { imageUploadProblem } from './MediaLibrary'
import { useInvalidateSite } from './BuilderData'

type Step = 'template' | 'brand' | 'launching' | 'done'

export function LaunchWebsiteModal({
  open,
  onOpenChange,
  defaultName,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultName: string
}) {
  const router = useRouter()
  const invalidate = useInvalidateSite()
  const { data: templates = [] } = useQuery({
    queryKey: ['site', 'templates'],
    queryFn: siteApi.listTemplates,
    enabled: open,
  })
  const [step, setStep] = React.useState<Step>('template')
  const [key, setKey] = React.useState<string | null>(null)
  const [name, setName] = React.useState(defaultName)
  const [color, setColor] = React.useState<string | null>(null)
  const [logo, setLogo] = React.useState<SiteAsset | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [useAi, setUseAi] = React.useState(true)
  const [publishNow, setPublishNow] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{
    url: string
    homeId: string | null
    aiUsed: boolean
  } | null>(null)

  React.useEffect(() => {
    if (open) {
      setStep('template')
      setError(null)
      setResult(null)
      setName(defaultName)
    }
  }, [open, defaultName])

  const template = templates.find((t) => t.key === key) ?? null

  const onLogo = async (file: File | undefined) => {
    if (!file) return
    const problem = imageUploadProblem(file)
    if (problem) return setError(problem)
    setUploading(true)
    setError(null)
    try {
      setLogo(await siteApi.uploadAsset(file, `${name} logo`))
    } catch (e) {
      setError(siteErrorMessage(e, 'Logo upload failed'))
    } finally {
      setUploading(false)
    }
  }

  const launch = async () => {
    if (!template) return
    setStep('launching')
    setError(null)
    try {
      const installed = await siteApi.installTemplate(template.key, 'replace')
      const s = installed.settings
      await siteApi.saveSettings({
        ...s,
        brand: {
          ...s.brand,
          displayName: name.trim() === defaultName.trim() ? '' : name.trim(),
          logo: logo ? { assetId: logo.id, alt: `${name} logo` } : s.brand.logo,
        },
        theme: color ? { ...s.theme, colors: { ...s.theme.colors, primary: color } } : s.theme,
      })
      let aiUsed = false
      if (useAi) aiUsed = (await siteApi.aiHomeCopy().catch(() => ({ generated: false }))).generated
      const final = publishNow ? await siteApi.publishSite('all') : await siteApi.getSite()
      invalidate()
      setResult({
        url: final.urls.canonical,
        homeId: final.pages.find((p) => p.kind === 'HOME')?.id ?? null,
        aiUsed,
      })
      setStep('done')
    } catch (e) {
      setError(siteErrorMessage(e, 'Could not create the website'))
      setStep('brand')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => step !== 'launching' && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(52rem,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-xl font-semibold text-slate-900">
                Launch your website
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-600">
                {step === 'template' && 'Pick a starting design — you can change everything later.'}
                {step === 'brand' && 'Add your name, logo and colour.'}
                {step === 'launching' && 'Building your pages…'}
                {step === 'done' && 'Your website is ready.'}
              </Dialog.Description>
            </div>
            {step !== 'launching' && (
              <Dialog.Close
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </Dialog.Close>
            )}
          </div>

          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {step === 'template' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setKey(t.key)}
                    aria-pressed={key === t.key}
                    className={cn(
                      'overflow-hidden rounded-2xl border text-left transition',
                      key === t.key
                        ? 'border-indigo-500 ring-2 ring-indigo-200'
                        : 'border-slate-200 hover:border-slate-300'
                    )}
                    data-testid={`launch-template-${t.key}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- bundled template artwork */}
                    <img
                      src={t.previewImage}
                      alt=""
                      className="aspect-[10/7] w-full object-cover"
                    />
                    <div className="p-3">
                      <div className="text-sm font-semibold text-slate-900">{t.name}</div>
                      <div className="text-xs text-slate-500">
                        {t.bestFor.slice(0, 2).join(' · ')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <AppButton disabled={!key} onClick={() => setStep('brand')}>
                  Continue
                </AppButton>
              </div>
            </>
          )}

          {step === 'brand' && template && (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="lw-name">Clinic name on the site</Label>
                    <input
                      id="lw-name"
                      className={inputCls}
                      value={name}
                      maxLength={80}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Logo</Label>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-600 hover:border-indigo-400">
                      {logo?.url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- uploaded logo preview
                        <img src={logo.url} alt="" className="h-10 w-10 rounded object-contain" />
                      ) : uploading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <ImagePlus className="h-5 w-5" />
                      )}
                      {logo ? 'Replace logo' : 'Upload a logo (optional)'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => void onLogo(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                  <div>
                    <Label htmlFor="lw-color">Brand colour</Label>
                    <div className="flex items-center gap-3">
                      <input
                        id="lw-color"
                        type="color"
                        value={color ?? template.theme.colors.primary}
                        onChange={(e) => setColor(e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded border border-slate-200 p-0.5"
                      />
                      <span className="text-xs text-slate-500">
                        {color ? 'Your colour' : `${template.name}’s colour`}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                  <Toggle label="Write my home page with AI" checked={useAi} onChange={setUseAi} />
                  <p className="text-xs text-slate-500">
                    <Sparkles className="mr-1 inline h-3 w-3" />
                    Uses only your clinic name and service names — never patient information. You
                    can edit every word afterwards.
                  </p>
                  <Toggle
                    label="Publish straight away"
                    checked={publishNow}
                    onChange={setPublishNow}
                  />
                  <p className="text-xs text-slate-500">
                    Turn off to review everything in the editor first.
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <AppButton variant="outline" onClick={() => setStep('template')}>
                  Back
                </AppButton>
                <AppButton onClick={() => void launch()} data-testid="launch-website">
                  Create my website
                </AppButton>
              </div>
            </>
          )}

          {step === 'launching' && (
            <div className="flex flex-col items-center gap-3 py-12 text-sm text-slate-600">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              Installing {template?.name}, applying your brand
              {useAi ? ', writing your home page' : ''}…
            </div>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              <p className="text-sm text-slate-700">
                {publishNow ? 'Your website is live at' : 'Your draft is ready. It will live at'}{' '}
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-indigo-600 hover:underline"
                >
                  {result.url.replace(/^https?:\/\//, '')}
                </a>
              </p>
              {useAi && !result.aiUsed && (
                <p className="text-xs text-amber-700">
                  AI copy wasn’t available right now, so the template’s copy is used — edit it any
                  time.
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {publishNow && (
                  <AppButton
                    variant="outline"
                    onClick={() => window.open(result.url, '_blank', 'noopener')}
                  >
                    <ExternalLink className="mr-1 h-4 w-4" /> View site
                  </AppButton>
                )}
                <AppButton
                  onClick={() => {
                    onOpenChange(false)
                    router.push(
                      `/dashboard/site/editor${result.homeId ? `?page=${result.homeId}` : ''}`
                    )
                  }}
                >
                  Customise in the editor
                </AppButton>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
