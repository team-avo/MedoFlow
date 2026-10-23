'use client'

/** Template gallery (F8.3): browse, preview on any device, install. */
import React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { Check, Eye, Loader2, X } from 'lucide-react'
import { siteApi, siteErrorMessage, type TemplateSummary } from '@/lib/site/siteApi'
import { AppButton, AppModal } from '@/components/ui-system'
import { SiteRenderer } from '@/components/site/SiteRenderer'
import { siteFontVariables } from '@/components/site/fonts'
import { DeviceFrame, DeviceToggle, type Device } from '@/components/site/builder/DeviceFrame'
import { useInvalidateSite, useSiteOverview } from '@/components/site/builder/BuilderData'
import { cn } from '@/lib/utils'

function Swatches({ t }: { t: TemplateSummary }) {
  const c = t.theme.colors
  return (
    <div className="flex gap-1" aria-hidden>
      {[c.primary, c.secondary, c.accent, c.surface].map((x, i) => (
        <span
          key={i}
          className="h-4 w-4 rounded-full border border-black/10"
          style={{ background: x }}
        />
      ))}
    </div>
  )
}

function PreviewDialog({
  template,
  onClose,
  onUse,
}: {
  template: TemplateSummary | null
  onClose: () => void
  onUse: (t: TemplateSummary) => void
}) {
  const [page, setPage] = React.useState('home')
  const [device, setDevice] = React.useState<Device>('desktop')
  React.useEffect(() => setPage('home'), [template?.key])
  const { data, isLoading } = useQuery({
    queryKey: ['site', 'template-preview', template?.key, page],
    queryFn: () => siteApi.templatePreview(template!.key, page),
    enabled: !!template,
  })
  return (
    <Dialog.Root open={!!template} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/50" />
        <Dialog.Content className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-2xl">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">{template?.name}</Dialog.Title>
            <Dialog.Description className="sr-only">
              Preview of the {template?.name} template with sample content.
            </Dialog.Description>
            <div className="flex flex-wrap gap-1">
              {template?.pages
                .filter((p) => p.kind !== 'LEGAL')
                .map((p) => (
                  <button
                    key={p.slug}
                    type="button"
                    onClick={() => setPage(p.slug)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-sm',
                      page === p.slug
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    )}
                  >
                    {p.title}
                  </button>
                ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <DeviceToggle value={device} onChange={setDevice} />
              {template && <AppButton onClick={() => onUse(template)}>Use this template</AppButton>}
              <Dialog.Close
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close preview"
              >
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading || !data ? (
              <p className="p-8 text-center text-sm text-slate-500">
                <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" /> Loading preview…
              </p>
            ) : (
              <DeviceFrame device={device}>
                <SiteRenderer
                  payload={data}
                  base=""
                  mode="editor"
                  fontClassName={siteFontVariables}
                />
              </DeviceFrame>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function TemplatesPage() {
  const router = useRouter()
  const invalidate = useInvalidateSite()
  const { data: site } = useSiteOverview()
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['site', 'templates'],
    queryFn: siteApi.listTemplates,
  })
  const [preview, setPreview] = React.useState<TemplateSummary | null>(null)
  const [installing, setInstalling] = React.useState<TemplateSummary | null>(null)
  const [mode, setMode] = React.useState<'replace' | 'styles-only'>('replace')
  const [busy, setBusy] = React.useState(false)
  const hasPages = (site?.pages.length ?? 0) > 0

  const install = async () => {
    if (!installing) return
    setBusy(true)
    try {
      const next = await siteApi.installTemplate(installing.key, hasPages ? mode : 'replace')
      invalidate()
      toast.success(`${installing.name} installed as a draft — publish when you’re ready`)
      const home = next.pages.find((p) => p.kind === 'HOME')
      router.push(`/dashboard/site/editor${home ? `?page=${home.id}` : ''}`)
    } catch (e) {
      toast.error(siteErrorMessage(e, 'Could not install the template'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Templates</h1>
        <p className="mt-1 text-sm text-slate-600">
          Each template is a complete website — pages, copy, colours and fonts. Your services, team
          and products fill in automatically. Nothing goes live until you publish.
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-500">Loading templates…</p>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const current = site?.templateKey === t.key
            return (
              <li
                key={t.key}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
                data-testid={`template-${t.key}`}
              >
                <button
                  type="button"
                  onClick={() => setPreview(t)}
                  className="group relative block aspect-[10/7] bg-slate-100"
                  aria-label={`Preview ${t.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- bundled template artwork */}
                  <img src={t.previewImage} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-sm font-semibold text-white opacity-0 transition group-hover:bg-slate-900/40 group-hover:opacity-100">
                    <Eye className="mr-1 h-4 w-4" /> Preview
                  </span>
                </button>
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">{t.name}</h2>
                    <Swatches t={t} />
                  </div>
                  <p className="text-sm font-medium text-slate-700">{t.tagline}</p>
                  <p className="text-sm text-slate-500">{t.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {t.bestFor.map((b) => (
                      <span
                        key={b}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400">
                    {t.pages.map((p) => p.title).join(' · ')}
                  </p>
                  <div className="mt-auto flex gap-2 pt-3">
                    <AppButton variant="outline" size="sm" onClick={() => setPreview(t)}>
                      Preview
                    </AppButton>
                    <AppButton size="sm" onClick={() => setInstalling(t)}>
                      {current ? (
                        <>
                          <Check className="mr-1 h-4 w-4" /> Reinstall
                        </>
                      ) : (
                        'Use this template'
                      )}
                    </AppButton>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <PreviewDialog
        template={preview}
        onClose={() => setPreview(null)}
        onUse={(t) => {
          setPreview(null)
          setInstalling(t)
        }}
      />

      <AppModal
        open={!!installing}
        onOpenChange={(o) => !o && setInstalling(null)}
        title={`Use ${installing?.name ?? ''}`}
        description="The template is installed into your drafts. Your live site doesn’t change until you publish."
        primaryAction={{
          label: busy ? 'Installing…' : 'Install template',
          onClick: () => void install(),
          disabled: busy,
        }}
        secondaryAction={{ label: 'Cancel', onClick: () => setInstalling(null) }}
      >
        {hasPages ? (
          <fieldset className="space-y-2">
            <legend className="sr-only">How to apply the template</legend>
            {(
              [
                [
                  'replace',
                  'Replace my pages',
                  'Theme, menus and every template page. Unpublished edits are kept in each page’s history.',
                ],
                [
                  'styles-only',
                  'Apply the look only',
                  'Colours, fonts and header/footer layout. Your pages stay as they are.',
                ],
              ] as const
            ).map(([value, title, desc]) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-xl border p-3',
                  mode === value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'
                )}
              >
                <input
                  type="radio"
                  name="install-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{title}</span>
                  <span className="block text-xs text-slate-600">{desc}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-sm text-slate-600">
            This creates {installing?.pages.length} pages with ready-written copy you can edit.
          </p>
        )}
      </AppModal>
    </div>
  )
}
