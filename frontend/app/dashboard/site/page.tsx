'use client'

/** Website overview (F8.1): live URL, publish state, setup checklist and every page. */
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  FilePlus2,
  LayoutTemplate,
  Loader2,
  Rocket,
} from 'lucide-react'
import { siteApi, siteErrorMessage, type SitePageSummary } from '@/lib/site/siteApi'
import { SITE_SLUG_RE, RESERVED_SITE_SEGMENTS } from '@/lib/site/routes'
import { newSection } from '@/lib/site/sections'
import { AppBadge, AppButton, AppModal } from '@/components/ui-system'
import { useInvalidateSite, useSiteOverview } from '@/components/site/builder/BuilderData'
import { inputCls, Label } from '@/components/site/builder/fields'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

function StatusBadge({ page }: { page: SitePageSummary }) {
  if (page.status !== 'PUBLISHED') return <AppBadge variant="neutral">Draft</AppBadge>
  if (page.hasUnpublishedChanges)
    return <AppBadge variant="warning">Changes not published</AppBadge>
  return <AppBadge variant="success">Live</AppBadge>
}

const KIND_LABEL: Record<SitePageSummary['kind'], string> = {
  HOME: 'Home',
  SERVICES: 'Services',
  TEAM: 'Team',
  CONTACT: 'Contact',
  LEGAL: 'Legal',
  STANDARD: 'Page',
}

export default function SiteOverviewPage() {
  const router = useRouter()
  const { data: site, isLoading, error } = useSiteOverview()
  const invalidate = useInvalidateSite()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [newTitle, setNewTitle] = React.useState('')
  const [newSlug, setNewSlug] = React.useState('')
  const [newKind, setNewKind] = React.useState<'STANDARD' | 'LEGAL'>('STANDARD')
  const [confirmDelete, setConfirmDelete] = React.useState<SitePageSummary | null>(null)

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try {
      await fn()
      if (ok) toast.success(ok)
      invalidate()
    } catch (e) {
      toast.error(siteErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <LoadingSkeleton variant="page" />
  if (error || !site)
    return (
      <p className="text-sm text-red-600">
        {siteErrorMessage(error, 'Could not load your website')}
      </p>
    )

  const pendingPages = site.pages.filter(
    (p) => p.hasUnpublishedChanges && (p.status === 'PUBLISHED' || p.version === 0)
  )
  const pending = site.hasUnpublishedSettings || pendingPages.length > 0
  const home = site.pages.find((p) => p.kind === 'HOME')
  const slugError =
    newSlug &&
    (!SITE_SLUG_RE.test(newSlug) || (newKind === 'STANDARD' && RESERVED_SITE_SEGMENTS.has(newSlug)))
      ? 'Use lowercase letters, numbers and hyphens (some words like "dashboard" are reserved)'
      : null

  const checklist = [
    { done: !!site.templateKey, label: 'Choose a template', href: '/dashboard/site/templates' },
    {
      done: !!(site.settings.brand.logo || site.clinic.legacyLogoUrl),
      label: 'Add your logo',
      href: '/dashboard/site/editor?panel=brand',
    },
    {
      done: home?.status === 'PUBLISHED',
      label: 'Publish your home page',
      href: home ? `/dashboard/site/editor?page=${home.id}` : '/dashboard/site/templates',
    },
    {
      done: site.urls.custom.length > 0,
      label: 'Connect your own domain (optional)',
      href: '/dashboard/site/domains',
    },
  ]

  if (site.pages.length === 0) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-white p-10 text-center">
        <LayoutTemplate className="mx-auto h-10 w-10 text-indigo-600" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Build your clinic’s website</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
          Pick a template designed for your kind of practice. Your services, team, products and
          opening hours fill in automatically — then make it yours.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <AppButton onClick={() => router.push('/dashboard/site/templates')}>
            Browse templates
          </AppButton>
          <AppButton
            variant="outline"
            disabled={busy === 'blank'}
            onClick={() =>
              void run('blank', async () => {
                const page = await siteApi.createPage({
                  kind: 'HOME',
                  title: 'Home',
                  sections: [
                    newSection('hero'),
                    newSection('service-grid'),
                    newSection('booking-cta'),
                  ],
                })
                router.push(`/dashboard/site/editor?page=${page.id}`)
              })
            }
          >
            Start from a blank page
          </AppButton>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Your website</h1>
            {site.publishedAt ? (
              <AppBadge variant="success">Live</AppBadge>
            ) : (
              <AppBadge variant="neutral">Not published yet</AppBadge>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <a
              href={site.urls.canonical}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-medium text-indigo-600 hover:underline"
              data-testid="site-url"
            >
              {site.urls.canonical.replace(/^https?:\/\//, '')}
            </a>
            <button
              type="button"
              aria-label="Copy site address"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(site.urls.canonical)
                  .then(() => toast.success('Copied'))
              }
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {site.pages.length} of {site.entitlements.maxPages} pages · template{' '}
            {site.templateKey ?? 'none'}
            {site.publishedAt && ` · published ${new Date(site.publishedAt).toLocaleString()}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AppButton
            variant="outline"
            onClick={() => router.push(`/dashboard/site/editor${home ? `?page=${home.id}` : ''}`)}
          >
            Customise
          </AppButton>
          <AppButton
            disabled={!pending || busy === 'publish'}
            onClick={() =>
              void run('publish', () => siteApi.publishSite('all'), 'Your website is live')
            }
            data-testid="publish-site"
          >
            {busy === 'publish' ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="mr-1 h-4 w-4" />
            )}
            {pending
              ? `Publish site${pendingPages.length ? ` (${pendingPages.length} page${pendingPages.length > 1 ? 's' : ''})` : ''}`
              : 'Everything is published'}
          </AppButton>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Pages</h2>
            <AppButton
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
              disabled={site.pages.length >= site.entitlements.maxPages}
            >
              <FilePlus2 className="mr-1 h-4 w-4" /> New page
            </AppButton>
          </div>
          <ul className="divide-y divide-slate-100">
            {site.pages.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
                data-testid={`page-row-${p.slug}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/dashboard/site/editor?page=${p.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {p.title}
                    </Link>
                    <span className="text-xs text-slate-400">{KIND_LABEL[p.kind]}</span>
                  </div>
                  <div className="text-xs text-slate-500">{p.path}</div>
                </div>
                <StatusBadge page={p} />
                <div className="flex flex-wrap gap-1">
                  <AppButton
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/dashboard/site/editor?page=${p.id}`)}
                  >
                    Edit
                  </AppButton>
                  {p.status === 'PUBLISHED' ? (
                    <>
                      <AppButton
                        size="sm"
                        variant="ghost"
                        disabled={busy === `un-${p.id}` || p.kind === 'HOME'}
                        title={p.kind === 'HOME' ? 'Your home page must stay published' : undefined}
                        onClick={() =>
                          void run(
                            `un-${p.id}`,
                            () => siteApi.unpublishPage(p.id),
                            'Page taken offline'
                          )
                        }
                      >
                        Unpublish
                      </AppButton>
                      <a
                        href={`${site.urls.canonical.replace(/\/+$/, '')}${p.path === '/' ? '/' : p.path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded-full px-3 text-sm text-slate-500 hover:bg-slate-100"
                        aria-label={`View ${p.title} live`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </>
                  ) : (
                    <AppButton
                      size="sm"
                      variant="ghost"
                      disabled={busy === `pub-${p.id}`}
                      onClick={() =>
                        void run(`pub-${p.id}`, () => siteApi.publishPage(p.id), 'Page published')
                      }
                    >
                      Publish
                    </AppButton>
                  )}
                  {(p.kind === 'STANDARD' || p.kind === 'LEGAL') && (
                    <>
                      <AppButton
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void run(
                            `dup-${p.id}`,
                            () => siteApi.duplicatePage(p.id),
                            'Page duplicated'
                          )
                        }
                      >
                        Duplicate
                      </AppButton>
                      <AppButton
                        size="sm"
                        variant="ghost"
                        className="text-red-600"
                        onClick={() => setConfirmDelete(p)}
                      >
                        Delete
                      </AppButton>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Setup</h2>
          <ul className="space-y-2">
            {checklist.map((c) => (
              <li key={c.label}>
                <Link
                  href={c.href}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                >
                  {c.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className="h-4 w-4 text-slate-300" />
                  )}
                  <span className={c.done ? 'text-slate-500 line-through' : 'text-slate-800'}>
                    {c.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Where your site lives</p>
            {site.urls.subdomain && (
              <p className="mt-1 truncate">Subdomain: {site.urls.subdomain}</p>
            )}
            {site.urls.custom.map((u) => (
              <p key={u} className="truncate">
                Custom: {u}
              </p>
            ))}
            {site.urls.appPath && <p className="truncate">Also: {site.urls.appPath}</p>}
          </div>
        </div>
      </div>

      <AppModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New page"
        description="It starts as a draft — publish it when it’s ready."
        primaryAction={{
          label: 'Create page',
          disabled: !newTitle.trim() || !newSlug || !!slugError || busy === 'create',
          onClick: () =>
            void run('create', async () => {
              const page = await siteApi.createPage({
                kind: newKind,
                title: newTitle.trim(),
                slug: newSlug,
                sections: [newSection('rich-text')],
                showInNav: newKind === 'STANDARD',
              })
              setCreateOpen(false)
              setNewTitle('')
              setNewSlug('')
              router.push(`/dashboard/site/editor?page=${page.id}`)
            }),
        }}
        secondaryAction={{ label: 'Cancel', onClick: () => setCreateOpen(false) }}
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="np-title">Title</Label>
            <input
              id="np-title"
              className={inputCls}
              value={newTitle}
              maxLength={200}
              onChange={(e) => {
                setNewTitle(e.target.value)
                setNewSlug(slugify(e.target.value))
              }}
            />
          </div>
          <div>
            <Label
              htmlFor="np-slug"
              hint={newKind === 'LEGAL' ? `/legal/${newSlug || '…'}` : `/${newSlug || '…'}`}
            >
              Address
            </Label>
            <input
              id="np-slug"
              className={inputCls}
              value={newSlug}
              maxLength={62}
              onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
            />
            {slugError && <p className="mt-1 text-xs text-red-600">{slugError}</p>}
          </div>
          <div>
            <Label htmlFor="np-kind">Type</Label>
            <select
              id="np-kind"
              className={inputCls}
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as 'STANDARD' | 'LEGAL')}
            >
              <option value="STANDARD">Standard page</option>
              <option value="LEGAL">Legal page (privacy, terms)</option>
            </select>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.title ?? ''}”?`}
        description="The page and its revision history are removed. Links to it will show plain text. This can’t be undone."
        primaryAction={{
          label: 'Delete page',
          onClick: () =>
            void run(
              'delete',
              async () => {
                if (confirmDelete) await siteApi.deletePage(confirmDelete.id)
                setConfirmDelete(null)
              },
              'Page deleted'
            ),
        }}
        secondaryAction={{ label: 'Cancel', onClick: () => setConfirmDelete(null) }}
      />
    </div>
  )
}
