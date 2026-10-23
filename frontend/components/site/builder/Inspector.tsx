'use client'

/** Right-hand panel of the editor: the selected section's layout + fields, or the page's settings. */
import React from 'react'
import { AlertCircle, X } from 'lucide-react'
import type { Section } from '@/lib/site/types'
import { SECTION_BY_TYPE, validateSection } from '@/lib/site/sections'
import type { EditorAction, EditorDoc } from '@/lib/site/editorState'
import type { SitePageDetail } from '@/lib/site/siteApi'
import { cn } from '@/lib/utils'
import { FieldEditor, ImageField, Label, Toggle, inputCls } from './fields'

export function SectionInspector({
  section,
  dispatch,
}: {
  section: Section
  dispatch: React.Dispatch<EditorAction>
}) {
  const def = SECTION_BY_TYPE.get(section.type)
  if (!def) return <p className="text-sm text-slate-500">Unknown section.</p>
  const check = validateSection(section)
  return (
    <div className="space-y-4" data-testid="section-inspector">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">{def.label}</h2>
          <p className="text-xs text-slate-500">{def.description}</p>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'select', id: null })}
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
          aria-label="Close section settings"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {!check.ok && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-xs text-red-700"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {check.error} — fix this to save
          the page.
        </p>
      )}
      {def.variants.length > 1 && (
        <div>
          <Label>Layout</Label>
          <div className="flex flex-wrap gap-1">
            {def.variants.map((v) => (
              <button
                key={v.value}
                type="button"
                aria-pressed={section.variant === v.value}
                onClick={() => dispatch({ type: 'variant', id: section.id, variant: v.value })}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium',
                  section.variant === v.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {def.fields.map((f) => (
        <FieldEditor
          key={f.key}
          field={f}
          value={section.settings[f.key]}
          onChange={(value) => dispatch({ type: 'settings', id: section.id, key: f.key, value })}
        />
      ))}
    </div>
  )
}

export function PageInspector({
  page,
  doc,
  dispatch,
  onPageMeta,
}: {
  page: SitePageDetail
  doc: EditorDoc
  dispatch: React.Dispatch<EditorAction>
  onPageMeta: (patch: {
    slug?: string
    showInNav?: boolean
    noindex?: boolean
    ogImageAssetId?: string | null
  }) => void
}) {
  const [slug, setSlug] = React.useState(page.slug)
  React.useEffect(() => setSlug(page.slug), [page.slug])
  const fixedSlug = ['HOME', 'SERVICES', 'TEAM', 'CONTACT'].includes(page.kind)
  return (
    <div className="space-y-4" data-testid="page-inspector">
      <h2 className="font-semibold text-slate-900">Page settings</h2>
      <div>
        <Label htmlFor="pi-title">Title</Label>
        <input
          id="pi-title"
          className={inputCls}
          value={doc.title}
          maxLength={200}
          onChange={(e) => dispatch({ type: 'meta', key: 'title', value: e.target.value })}
        />
      </div>
      {!fixedSlug && (
        <div>
          <Label htmlFor="pi-slug" hint="changing it keeps the old address working">
            Address
          </Label>
          <div className="flex gap-2">
            <input
              id="pi-slug"
              className={inputCls}
              value={slug}
              maxLength={62}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
            <button
              type="button"
              disabled={slug === page.slug}
              onClick={() => onPageMeta({ slug })}
              className="rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
      <div>
        <Label htmlFor="pi-seo-title" hint="shown in Google results">
          Search title
        </Label>
        <input
          id="pi-seo-title"
          className={inputCls}
          value={doc.seoTitle}
          maxLength={200}
          placeholder={doc.title}
          onChange={(e) => dispatch({ type: 'meta', key: 'seoTitle', value: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="pi-seo-desc" hint={`${doc.seoDescription.length}/500`}>
          Search description
        </Label>
        <textarea
          id="pi-seo-desc"
          className={inputCls}
          rows={3}
          maxLength={500}
          value={doc.seoDescription}
          onChange={(e) => dispatch({ type: 'meta', key: 'seoDescription', value: e.target.value })}
        />
      </div>
      <ImageField
        label="Social sharing image"
        value={page.ogImageAssetId ? { assetId: page.ogImageAssetId, alt: '' } : null}
        onChange={(img) => onPageMeta({ ogImageAssetId: img?.assetId ?? null })}
      />
      {page.kind !== 'HOME' && (
        <Toggle
          label="Show in the site menu"
          checked={page.showInNav}
          onChange={(showInNav) => onPageMeta({ showInNav })}
        />
      )}
      <Toggle
        label="Hide from search engines"
        checked={page.noindex}
        onChange={(noindex) => onPageMeta({ noindex })}
      />
    </div>
  )
}
