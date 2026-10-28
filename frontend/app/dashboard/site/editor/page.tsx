'use client'

/**
 * The website editor (F8.2): sections, theme, brand and menus on the left,
 * a live canvas in the middle (the real renderer, on the draft), settings for
 * the selection on the right. Edits autosave to the draft; Publish makes the
 * page and the site settings live together.
 */
import React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  History,
  Loader2,
  Redo2,
  Rocket,
  Undo2,
  X,
} from 'lucide-react'
import { siteApi, siteErrorMessage, type SitePageDetail } from '@/lib/site/siteApi'
import type { RenderPayload, SiteRouteKey, SiteSettings } from '@/lib/site/types'
import {
  canRedo,
  canUndo,
  editorReducer,
  initEditor,
  isDirty,
  type EditorDoc,
} from '@/lib/site/editorState'
import { validateSection } from '@/lib/site/sections'
import { brokenLinks, resolveClient } from '@/lib/site/resolveClient'
import { SiteRenderer } from '@/components/site/SiteRenderer'
import { siteFontVariables } from '@/components/site/fonts'
import { AppButton } from '@/components/ui-system'
import { cn } from '@/lib/utils'
import {
  targetsFrom,
  useEditorData,
  useInvalidateSite,
  useSiteOverview,
} from '@/components/site/builder/BuilderData'
import { SectionTree } from '@/components/site/builder/SectionTree'
import { PageInspector, SectionInspector } from '@/components/site/builder/Inspector'
import {
  BrandSeoEditor,
  HeaderFooterEditor,
  ThemeEditor,
} from '@/components/site/builder/SettingsEditors'
import { DeviceFrame, DeviceToggle, type Device } from '@/components/site/builder/DeviceFrame'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

type Panel = 'sections' | 'theme' | 'brand' | 'header'
type SaveState = 'saved' | 'saving' | 'unsaved' | 'invalid' | 'error'
const AUTOSAVE_MS = 1500

const ROUTE_FOR_KIND: Record<SitePageDetail['kind'], SiteRouteKey> = {
  HOME: 'home',
  STANDARD: 'page',
  SERVICES: 'services',
  TEAM: 'team',
  CONTACT: 'contact',
  LEGAL: 'legal',
}

const docFrom = (p: SitePageDetail): EditorDoc => ({
  title: p.title,
  seoTitle: p.seoTitle ?? '',
  seoDescription: p.seoDescription ?? '',
  sections: p.sections,
})

function SaveIndicator({ state, message }: { state: SaveState; message: string }) {
  const map: Record<SaveState, { text: string; cls: string }> = {
    saved: { text: 'All changes saved', cls: 'text-slate-500' },
    saving: { text: 'Saving…', cls: 'text-slate-500' },
    unsaved: { text: 'Unsaved changes', cls: 'text-amber-600' },
    invalid: { text: message || 'Fix the highlighted section to save', cls: 'text-red-600' },
    error: { text: message || 'Could not save', cls: 'text-red-600' },
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs', map[state].cls)}
      role="status"
      data-testid="save-state"
    >
      {state === 'saving' && <Loader2 className="h-3 w-3 animate-spin" />}
      {state === 'saved' && <CheckCircle2 className="h-3 w-3" />}
      {map[state].text}
    </span>
  )
}

function RevisionsDialog({
  pageId,
  open,
  onOpenChange,
  onRestored,
}: {
  pageId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onRestored: (p: SitePageDetail) => void
}) {
  const { data: revs = [], isLoading } = useQuery({
    queryKey: ['site', 'revisions', pageId],
    queryFn: () => siteApi.listRevisions(pageId),
    enabled: open,
  })
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/30" />
        <Dialog.Content className="fixed right-0 top-0 z-50 h-full w-[min(26rem,100vw)] overflow-y-auto bg-white p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-slate-900">
              Published versions
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mb-4 text-sm text-slate-500">
            Restoring copies a version into your draft. Publish to make it live again.
          </Dialog.Description>
          {isLoading ? (
            <LoadingSkeleton variant="row" count={3} />
          ) : revs.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing published yet.</p>
          ) : (
            <ul className="space-y-2">
              {revs.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 p-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Version {r.version}</div>
                    <div className="text-xs text-slate-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <AppButton
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        onRestored(await siteApi.restoreRevision(pageId, r.version))
                        onOpenChange(false)
                        toast.success(`Version ${r.version} restored to your draft`)
                      } catch (e) {
                        toast.error(siteErrorMessage(e))
                      }
                    }}
                  >
                    Restore
                  </AppButton>
                </li>
              ))}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SiteEditor() {
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const invalidate = useInvalidateSite()
  const { data: site } = useSiteOverview()
  const { data: ed } = useEditorData()

  const requestedPage = params.get('page')
  const pageId =
    requestedPage ?? site?.pages.find((p) => p.kind === 'HOME')?.id ?? site?.pages[0]?.id ?? null
  React.useEffect(() => {
    if (!requestedPage && pageId) router.replace(`/dashboard/site/editor?page=${pageId}`)
  }, [requestedPage, pageId, router])

  const { data: page, error: pageError } = useQuery({
    queryKey: ['site', 'page', pageId],
    queryFn: () => siteApi.getPage(pageId!),
    enabled: !!pageId,
    refetchOnWindowFocus: false,
  })

  const [state, dispatch] = React.useReducer(editorReducer, undefined, () =>
    initEditor({ title: '', seoTitle: '', seoDescription: '', sections: [] })
  )
  const [loadedId, setLoadedId] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (page && page.id !== loadedId) {
      dispatch({ type: 'load', doc: docFrom(page) })
      setLoadedId(page.id)
    }
  }, [page, loadedId])

  const [settings, setSettings] = React.useState<SiteSettings | null>(null)
  const [settingsSaved, setSettingsSaved] = React.useState<string>('')
  React.useEffect(() => {
    if (site && settings === null) {
      setSettings(site.settings)
      setSettingsSaved(JSON.stringify(site.settings))
    }
  }, [site, settings])

  const [panel, setPanel] = React.useState<Panel>((params.get('panel') as Panel) || 'sections')
  const [device, setDevice] = React.useState<Device>('desktop')
  const [saveState, setSaveState] = React.useState<SaveState>('saved')
  const [saveMessage, setSaveMessage] = React.useState('')
  const [publishing, setPublishing] = React.useState(false)
  const [revisionsOpen, setRevisionsOpen] = React.useState(false)

  const dirty = loadedId !== null && isDirty(state)
  const settingsDirty = settings !== null && JSON.stringify(settings) !== settingsSaved
  const invalid = state.doc.sections
    .map((s) => ({ s, check: validateSection(s) }))
    .filter((x) => !x.check.ok)

  // ── autosave ─────────────────────────────────────────────────────────────
  const savePage = React.useCallback(async (): Promise<boolean> => {
    if (!pageId || !dirty) return true
    if (invalid.length) {
      setSaveState('invalid')
      const first = invalid[0]!
      setSaveMessage(first.check.ok ? '' : first.check.error)
      return false
    }
    const doc = state.doc
    setSaveState('saving')
    try {
      const saved = await siteApi.savePage(pageId, {
        title: doc.title.trim() || 'Untitled',
        seoTitle: doc.seoTitle || null,
        seoDescription: doc.seoDescription || null,
        sections: doc.sections,
      })
      dispatch({ type: 'saved', doc })
      qc.setQueryData(['site', 'page', pageId], saved)
      setSaveState('saved')
      return true
    } catch (e) {
      setSaveState('error')
      setSaveMessage(siteErrorMessage(e, 'Could not save'))
      return false
    }
  }, [pageId, dirty, invalid, state.doc, qc])

  const saveSettings = React.useCallback(async (): Promise<boolean> => {
    if (!settings || !settingsDirty) return true
    try {
      const saved = await siteApi.saveSettings(settings)
      setSettingsSaved(JSON.stringify(saved))
      return true
    } catch (e) {
      setSaveState('error')
      setSaveMessage(siteErrorMessage(e, 'Could not save site settings'))
      return false
    }
  }, [settings, settingsDirty])

  React.useEffect(() => {
    if (!dirty) return
    setSaveState(invalid.length ? 'invalid' : 'unsaved')
    const t = setTimeout(() => void savePage(), AUTOSAVE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save when the document changes
  }, [state.doc])

  React.useEffect(() => {
    if (!settingsDirty) return
    const t = setTimeout(() => void saveSettings(), AUTOSAVE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save when settings change
  }, [settings])

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || settingsDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, settingsDirty])

  // ── keyboard: undo / redo ────────────────────────────────────────────────
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input,textarea,select,[contenteditable="true"]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const publish = async () => {
    if (!pageId) return
    setPublishing(true)
    try {
      if (!(await savePage()) || !(await saveSettings())) return
      await siteApi.publishSite([pageId])
      invalidate()
      void qc.invalidateQueries({ queryKey: ['site', 'page', pageId] })
      toast.success('Published — your changes are live')
    } catch (e) {
      toast.error(siteErrorMessage(e, 'Could not publish'))
    } finally {
      setPublishing(false)
    }
  }

  const openPreview = async () => {
    if (!pageId) return
    if (!(await savePage()) || !(await saveSettings())) return
    try {
      const { url } = await siteApi.previewLink(pageId)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast.error(siteErrorMessage(e))
    }
  }

  const onPageMeta = async (patch: Parameters<typeof siteApi.savePage>[1]) => {
    if (!pageId) return
    try {
      const saved = await siteApi.savePage(pageId, patch)
      qc.setQueryData(['site', 'page', pageId], saved)
      invalidate()
      toast.success('Page updated')
    } catch (e) {
      toast.error(siteErrorMessage(e))
    }
  }

  // ── canvas payload: the draft, resolved like the live renderer would ────
  const targets = React.useMemo(() => targetsFrom(ed), [ed])
  const payload: RenderPayload | null = React.useMemo(() => {
    if (!site || !ed || !page || !settings) return null
    return {
      site: {
        clinicId: site.clinic.id,
        name: settings.brand.displayName || site.clinic.name,
        slug: site.clinic.slug,
        canonicalBase: site.urls.canonical,
        settings: resolveClient(settings, targets),
        showBadge: ed.showBadge,
        legacyLogoUrl: site.clinic.legacyLogoUrl,
        hasStore: ed.hasStore,
      },
      route: { key: ROUTE_FOR_KIND[page.kind], path: page.path, params: {} },
      page: {
        id: page.id,
        kind: page.kind,
        title: state.doc.title,
        seoTitle: state.doc.seoTitle || null,
        seoDescription: state.doc.seoDescription || null,
        noindex: page.noindex,
        sections: resolveClient(state.doc.sections, targets),
      },
      entity: null,
      data: ed.data,
      preview: false,
    }
  }, [site, ed, page, settings, state.doc, targets])

  const broken = React.useMemo(
    () => (settings ? brokenLinks([settings, state.doc.sections], targets) : []),
    [settings, state.doc.sections, targets]
  )
  const selected = state.doc.sections.find((s) => s.id === state.selectedId) ?? null

  React.useEffect(() => {
    if (!state.selectedId) return
    document
      .querySelector(`[data-section-id="${state.selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.selectedId])

  if (site && site.pages.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-slate-700">Your site has no pages yet.</p>
        <AppButton className="mt-4" onClick={() => router.push('/dashboard/site/templates')}>
          Choose a template
        </AppButton>
      </div>
    )
  }
  if (pageError)
    return <p className="text-sm text-red-600">{siteErrorMessage(pageError, 'Page not found')}</p>
  if (!payload || !page || !settings)
    return <p className="text-sm text-slate-500">Loading the editor…</p>

  const statusLabel =
    page.status === 'PUBLISHED'
      ? page.hasUnpublishedChanges || dirty || settingsDirty
        ? 'Changes not published'
        : 'Live'
      : 'Draft'

  return (
    <div
      className={cn(
        'flex h-[calc(100vh-11rem)] min-h-[36rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white',
        siteFontVariables
      )}
    >
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <select
          aria-label="Page"
          className="max-w-[14rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium"
          value={pageId ?? ''}
          onChange={async (e) => {
            await savePage()
            setLoadedId(null)
            router.push(`/dashboard/site/editor?page=${e.target.value}`)
          }}
        >
          {site?.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} ({p.path})
            </option>
          ))}
        </select>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            statusLabel === 'Live'
              ? 'bg-emerald-50 text-emerald-700'
              : statusLabel === 'Draft'
                ? 'bg-slate-100 text-slate-600'
                : 'bg-amber-50 text-amber-700'
          )}
        >
          {statusLabel}
        </span>
        <SaveIndicator
          state={settingsDirty && saveState === 'saved' ? 'unsaved' : saveState}
          message={saveMessage}
        />
        {broken.length > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs text-amber-700"
            title="Some links point to pages or items that no longer exist; they show as plain text."
          >
            <AlertTriangle className="h-3.5 w-3.5" /> {broken.length} broken link
            {broken.length > 1 ? 's' : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={!canUndo(state)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={!canRedo(state)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            aria-label="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <DeviceToggle value={device} onChange={setDevice} />
          <button
            type="button"
            onClick={() => setRevisionsOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
            aria-label="Published versions"
          >
            <History className="h-4 w-4" />
          </button>
          <AppButton size="sm" variant="outline" onClick={() => void openPreview()}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Preview
          </AppButton>
          <AppButton
            size="sm"
            onClick={() => void publish()}
            disabled={publishing || invalid.length > 0}
            data-testid="publish-page"
          >
            {publishing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="mr-1 h-3.5 w-3.5" />
            )}{' '}
            Publish
          </AppButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* left: structure + site settings */}
        <aside className="flex w-[19rem] shrink-0 flex-col border-r border-slate-200">
          <div
            className="flex gap-1 border-b border-slate-200 p-2"
            role="tablist"
            aria-label="Editor panels"
          >
            {(
              [
                ['sections', 'Sections'],
                ['theme', 'Theme'],
                ['brand', 'Brand & SEO'],
                ['header', 'Menus'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={panel === k}
                type="button"
                onClick={() => setPanel(k)}
                className={cn(
                  'flex-1 rounded-md px-1.5 py-1 text-xs font-medium',
                  panel === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {panel === 'sections' && (
              <>
                <SectionTree
                  sections={state.doc.sections}
                  selectedId={state.selectedId}
                  dispatch={dispatch}
                />
                {invalid.length > 0 && (
                  <p className="mt-3 text-xs text-red-600">
                    {invalid.length} section{invalid.length > 1 ? 's need' : ' needs'} attention
                    before saving.
                  </p>
                )}
              </>
            )}
            {panel === 'theme' && <ThemeEditor settings={settings} onChange={setSettings} />}
            {panel === 'brand' && <BrandSeoEditor settings={settings} onChange={setSettings} />}
            {panel === 'header' && (
              <HeaderFooterEditor settings={settings} onChange={setSettings} />
            )}
          </div>
        </aside>

        {/* centre: live canvas */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-slate-100 p-4" aria-label="Page preview">
          <DeviceFrame device={device}>
            <SiteRenderer
              payload={payload}
              base=""
              mode="editor"
              selectedId={state.selectedId}
              onSelect={(id) => {
                setPanel('sections')
                dispatch({ type: 'select', id })
              }}
            />
          </DeviceFrame>
        </main>

        {/* right: inspector */}
        <aside className="w-[22rem] shrink-0 overflow-y-auto border-l border-slate-200 p-4">
          {selected ? (
            <SectionInspector section={selected} dispatch={dispatch} />
          ) : (
            <PageInspector
              page={page}
              doc={state.doc}
              dispatch={dispatch}
              onPageMeta={(p) => void onPageMeta(p)}
            />
          )}
        </aside>
      </div>

      <RevisionsDialog
        pageId={page.id}
        open={revisionsOpen}
        onOpenChange={setRevisionsOpen}
        onRestored={(p) => {
          qc.setQueryData(['site', 'page', p.id], p)
          dispatch({ type: 'load', doc: docFrom(p) })
        }}
      />
    </div>
  )
}

export default function SiteEditorPage() {
  return (
    <React.Suspense fallback={<p className="text-sm text-slate-500">Loading the editor…</p>}>
      <SiteEditor />
    </React.Suspense>
  )
}
