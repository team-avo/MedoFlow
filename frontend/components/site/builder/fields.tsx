'use client'

/**
 * Form controls generated from the section field definitions
 * (lib/site/sections.ts). One FieldEditor renders any field kind, so a new
 * section type needs no new editor code.
 */
import React from 'react'
import { ArrowDown, ArrowUp, ImageIcon, Link2, Plus, Trash2, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import type { FieldDef, IdSource } from '@/lib/site/sections'
import { newListItem, VIDEO_URL_RE } from '@/lib/site/sections'
import type { Cta, ImageRef, LinkableRoute, SiteLink } from '@/lib/site/types'
import { isSafeExternalHref } from '@/lib/site/links'
import { cn } from '@/lib/utils'
import { useEditorData } from './BuilderData'
import { MediaLibrary } from './MediaLibrary'

export const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100'

export function Label({
  children,
  hint,
  htmlFor,
}: {
  children: React.ReactNode
  hint?: string
  htmlFor?: string
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-700">
      {children}
      {hint && <span className="ml-1 font-normal text-slate-400">· {hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm text-slate-700">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-indigo-600' : 'bg-slate-300'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5'
          )}
        />
      </button>
    </label>
  )
}

/* ── links ─────────────────────────────────────────────────────────────── */

const ROUTE_OPTIONS: { value: LinkableRoute; label: string }[] = [
  { value: 'home', label: 'Home page' },
  { value: 'services', label: 'Services page' },
  { value: 'team', label: 'Team page' },
  { value: 'store', label: 'Store' },
  { value: 'contact', label: 'Contact page' },
  { value: 'book', label: 'Booking page' },
]

type LinkChoice = 'booking' | 'route' | 'page' | 'service' | 'provider' | 'product' | 'external'

export function LinkPicker({
  value,
  onChange,
  id,
}: {
  value: SiteLink | null
  onChange: (l: SiteLink) => void
  id?: string
}) {
  const { data: ed } = useEditorData()
  const kind: LinkChoice = (value?.kind === 'anchor' ? 'route' : value?.kind) ?? 'booking'
  const [ext, setExt] = React.useState(value?.kind === 'external' ? value.href : 'https://')
  const extValid = isSafeExternalHref(ext)

  const setKind = (k: LinkChoice) => {
    if (k === 'booking') onChange({ kind: 'booking' })
    else if (k === 'route') onChange({ kind: 'route', route: 'services' })
    else if (k === 'page' && ed?.pages[0]) onChange({ kind: 'page', pageId: ed.pages[0].id })
    else if (k === 'service' && ed?.data.services[0])
      onChange({ kind: 'service', serviceId: ed.data.services[0].id })
    else if (k === 'provider' && ed?.data.providers[0])
      onChange({ kind: 'provider', providerId: ed.data.providers[0].id })
    else if (k === 'product' && ed?.data.products[0])
      onChange({ kind: 'product', productId: ed.data.products[0].id })
    else if (k === 'external')
      onChange({ kind: 'external', href: extValid ? ext : 'https://example.com' })
  }

  return (
    <div className="space-y-2">
      <select
        id={id}
        className={inputCls}
        value={kind}
        onChange={(e) => setKind(e.target.value as LinkChoice)}
        aria-label="Link goes to"
      >
        <option value="booking">Book an appointment</option>
        <option value="route">A site page (services, team…)</option>
        <option value="page" disabled={!ed?.pages.length}>
          One of my pages
        </option>
        <option value="service" disabled={!ed?.data.services.length}>
          A service
        </option>
        <option value="provider" disabled={!ed?.data.providers.length}>
          A team member
        </option>
        <option value="product" disabled={!ed?.data.products.length}>
          A product
        </option>
        <option value="external">Another website, email or phone</option>
      </select>
      {value?.kind === 'route' && (
        <select
          className={inputCls}
          value={value.route}
          onChange={(e) => onChange({ kind: 'route', route: e.target.value as LinkableRoute })}
          aria-label="Site page"
        >
          {ROUTE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {value?.kind === 'booking' && (
        <select
          className={inputCls}
          value={value.serviceId ?? ''}
          onChange={(e) =>
            onChange(
              e.target.value ? { kind: 'booking', serviceId: e.target.value } : { kind: 'booking' }
            )
          }
          aria-label="Service to book"
        >
          <option value="">Let the visitor choose</option>
          {ed?.data.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {value?.kind === 'page' && (
        <select
          className={inputCls}
          value={value.pageId}
          onChange={(e) => onChange({ kind: 'page', pageId: e.target.value })}
          aria-label="Page"
        >
          {ed?.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} ({p.path}){p.status === 'DRAFT' ? ' — draft' : ''}
            </option>
          ))}
        </select>
      )}
      {value?.kind === 'service' && (
        <select
          className={inputCls}
          value={value.serviceId}
          onChange={(e) => onChange({ kind: 'service', serviceId: e.target.value })}
          aria-label="Service"
        >
          {ed?.data.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {value?.kind === 'provider' && (
        <select
          className={inputCls}
          value={value.providerId}
          onChange={(e) => onChange({ kind: 'provider', providerId: e.target.value })}
          aria-label="Team member"
        >
          {ed?.data.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {value?.kind === 'product' && (
        <select
          className={inputCls}
          value={value.productId}
          onChange={(e) => onChange({ kind: 'product', productId: e.target.value })}
          aria-label="Product"
        >
          {ed?.data.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {value?.kind === 'external' && (
        <div>
          <input
            className={cn(inputCls, !extValid && 'border-red-300')}
            value={ext}
            placeholder="https://… , mailto:… or tel:…"
            aria-label="Link address"
            onChange={(e) => {
              setExt(e.target.value)
              if (isSafeExternalHref(e.target.value))
                onChange({ kind: 'external', href: e.target.value })
            }}
          />
          {!extValid && <p className="mt-1 text-xs text-red-600">Use https://, mailto: or tel:</p>}
        </div>
      )}
    </div>
  )
}

export function CtaEditor({
  value,
  onChange,
  label,
}: {
  value: Cta | null
  onChange: (v: Cta | null) => void
  label: string
}) {
  if (!value) {
    return (
      <div>
        <Label>{label}</Label>
        <button
          type="button"
          onClick={() => onChange({ label: 'Book now', link: { kind: 'booking' } })}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
        >
          <Plus className="h-4 w-4" /> Add a button
        </button>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label={`Remove ${label}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        className={cn(inputCls, 'mb-2')}
        value={value.label}
        maxLength={40}
        aria-label={`${label} text`}
        onChange={(e) => onChange({ ...value, label: e.target.value })}
      />
      <LinkPicker value={value.link} onChange={(link) => onChange({ ...value, link })} />
    </div>
  )
}

/* ── images ────────────────────────────────────────────────────────────── */

export function MediaPickerDialog({
  open,
  onOpenChange,
  onPick,
  selectedId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (img: ImageRef) => void
  selectedId?: string | null
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(56rem,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-slate-900">
              Choose an image
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Upload a new image or pick one from your library.
          </Dialog.Description>
          <MediaLibrary
            selectedId={selectedId}
            onPick={(a) => {
              onPick({ assetId: a.id, alt: a.alt })
              onOpenChange(false)
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ImageField({
  value,
  onChange,
  label,
}: {
  value: ImageRef | null
  onChange: (v: ImageRef | null) => void
  label: string
}) {
  const { data: ed } = useEditorData()
  const [open, setOpen] = React.useState(false)
  const url = value?.assetId ? ed?.assets.find((a) => a.id === value.assetId)?.url : value?.src
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 hover:border-indigo-400"
          aria-label={`Choose ${label}`}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- builder thumbnail of a site image
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-slate-400" />
          )}
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          {value && (
            <input
              className={inputCls}
              value={value.alt}
              maxLength={200}
              placeholder="Alt text (describe the image)"
              aria-label={`${label} alt text`}
              onChange={(e) => onChange({ ...value, alt: e.target.value })}
            />
          )}
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              className="font-semibold text-indigo-600 hover:underline"
              onClick={() => setOpen(true)}
            >
              {value ? 'Replace' : 'Choose image'}
            </button>
            {value && (
              <button
                type="button"
                className="text-slate-500 hover:underline"
                onClick={() => onChange(null)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        selectedId={value?.assetId}
        onPick={(img) => onChange({ ...img, alt: value?.alt || img.alt })}
      />
    </div>
  )
}

function ImagesField({
  value,
  onChange,
  label,
  max,
}: {
  value: ImageRef[]
  onChange: (v: ImageRef[]) => void
  label: string
  max: number
}) {
  const { data: ed } = useEditorData()
  const [open, setOpen] = React.useState(false)
  return (
    <div>
      <Label hint={`${value.length}/${max}`}>{label}</Label>
      <div className="grid grid-cols-3 gap-2">
        {value.map((img, i) => {
          const url = img.assetId ? ed?.assets.find((a) => a.id === img.assetId)?.url : img.src
          return (
            <div
              key={i}
              className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
            >
              {url && (
                // eslint-disable-next-line @next/next/no-img-element -- builder thumbnail of a site image
                <img src={url} alt={img.alt} className="h-full w-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded bg-white/90 p-0.5 text-slate-600 opacity-0 shadow group-hover:opacity-100"
                aria-label="Remove image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
        {value.length < max && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-600"
            aria-label="Add image"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        onPick={(img) => onChange([...value, img])}
      />
    </div>
  )
}

/* ── ids, lists, video ─────────────────────────────────────────────────── */

function IdsPicker({
  source,
  value,
  onChange,
  label,
  hint,
  max,
}: {
  source: IdSource
  value: string[]
  onChange: (v: string[]) => void
  label: string
  hint?: string
  max: number
}) {
  const { data: ed } = useEditorData()
  const options =
    source === 'services'
      ? ed?.data.services.map((s) => ({ id: s.id, name: s.name }))
      : source === 'providers'
        ? ed?.data.providers.map((p) => ({ id: p.id, name: p.name }))
        : source === 'products'
          ? ed?.data.products.map((p) => ({ id: p.id, name: p.name }))
          : ed?.data.locations.map((l) => ({ id: l.id, name: l.name }))
  return (
    <div>
      <Label hint={hint}>{label}</Label>
      {!options?.length ? (
        <p className="text-xs text-slate-500">Nothing to choose from yet.</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {options.map((o) => {
            const checked = value.includes(o.id)
            return (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && value.length >= max}
                    onChange={() =>
                      onChange(checked ? value.filter((x) => x !== o.id) : [...value, o.id])
                    }
                  />
                  {o.name}
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ListEditor({
  field,
  value,
  onChange,
}: {
  field: Extract<FieldDef, { kind: 'list' }>
  value: Record<string, unknown>[]
  onChange: (v: Record<string, unknown>[]) => void
}) {
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }
  return (
    <div>
      <Label hint={`${value.length}/${field.max}`}>{field.label}</Label>
      <div className="space-y-2">
        {value.map((item, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                {field.itemLabel} {i + 1}
              </span>
              <div className="flex gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600"
                  aria-label={`Remove ${field.itemLabel}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {field.fields.map((f) => (
                <FieldEditor
                  key={f.key}
                  field={f}
                  value={item[f.key]}
                  onChange={(v) =>
                    onChange(value.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)))
                  }
                />
              ))}
            </div>
          </div>
        ))}
        {value.length < field.max && (
          <button
            type="button"
            onClick={() => onChange([...value, newListItem(field)])}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
          >
            <Plus className="h-4 w-4" /> Add {field.itemLabel.toLowerCase()}
          </button>
        )}
      </div>
    </div>
  )
}

export function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const id = React.useId()
  switch (field.kind) {
    case 'text':
      return (
        <div>
          <Label htmlFor={id}>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </Label>
          <input
            id={id}
            className={inputCls}
            value={typeof value === 'string' ? value : ''}
            maxLength={field.max}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )
    case 'textarea':
    case 'markdown':
      return (
        <div>
          <Label
            htmlFor={id}
            hint={
              field.kind === 'markdown'
                ? '**bold**, *italic*, [link](/contact), - lists'
                : undefined
            }
          >
            {field.label}
            {field.kind === 'textarea' && field.required && (
              <span className="text-red-500"> *</span>
            )}
          </Label>
          <textarea
            id={id}
            className={cn(inputCls, 'min-h-[5rem]')}
            rows={field.kind === 'markdown' ? 6 : 3}
            value={typeof value === 'string' ? value : ''}
            maxLength={field.max}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )
    case 'number':
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <input
            id={id}
            type="number"
            className={inputCls}
            min={field.min}
            max={field.max}
            value={typeof value === 'number' ? value : field.default}
            onChange={(e) =>
              onChange(
                Math.max(field.min, Math.min(field.max, Number(e.target.value) || field.min))
              )
            }
          />
        </div>
      )
    case 'boolean':
      return (
        <Toggle
          label={field.label}
          checked={typeof value === 'boolean' ? value : field.default}
          onChange={onChange}
        />
      )
    case 'image':
      return (
        <ImageField
          label={field.label}
          value={(value as ImageRef | null) ?? null}
          onChange={onChange}
        />
      )
    case 'images':
      return (
        <ImagesField
          label={field.label}
          max={field.max}
          value={Array.isArray(value) ? (value as ImageRef[]) : []}
          onChange={onChange}
        />
      )
    case 'cta':
      return (
        <CtaEditor label={field.label} value={(value as Cta | null) ?? null} onChange={onChange} />
      )
    case 'video': {
      const v = typeof value === 'string' ? value : ''
      return (
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              id={id}
              className={cn(inputCls, 'pl-8', v && !VIDEO_URL_RE.test(v) && 'border-red-300')}
              value={v}
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
          {!VIDEO_URL_RE.test(v) && (
            <p className="mt-1 text-xs text-red-600">
              Paste a YouTube or Vimeo link to save this section.
            </p>
          )}
        </div>
      )
    }
    case 'ids':
      return (
        <IdsPicker
          source={field.source}
          label={field.label}
          hint={field.hint}
          max={field.max}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
        />
      )
    case 'list':
      return (
        <ListEditor
          field={field}
          value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
          onChange={onChange}
        />
      )
  }
}
