'use client'

/** Site-wide settings editors: theme, brand & SEO, header & footer menus. */
import React from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { NavItem, SiteLink, SiteSettings, SiteTheme } from '@/lib/site/types'
import { FONT_PAIRS, contrastIssues } from '@/lib/site/theme'
import { cn } from '@/lib/utils'
import { CtaEditor, ImageField, Label, LinkPicker, Toggle, inputCls } from './fields'

type Update = (next: SiteSettings) => void

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-slate-100 pb-5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const id = React.useId()
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

const COLOR_LABELS: Record<keyof SiteTheme['colors'], string> = {
  primary: 'Primary (buttons, links)',
  secondary: 'Secondary (footer, banner)',
  accent: 'Accent',
  background: 'Background',
  surface: 'Alternate background',
  text: 'Text',
  muted: 'Secondary text',
}

export function ThemeEditor({ settings, onChange }: { settings: SiteSettings; onChange: Update }) {
  const theme = settings.theme
  const set = (patch: Partial<SiteTheme>) =>
    onChange({ ...settings, theme: { ...theme, ...patch } })
  const issues = contrastIssues(theme)
  return (
    <div className="space-y-5">
      <Group title="Colours">
        {(Object.keys(COLOR_LABELS) as (keyof SiteTheme['colors'])[]).map((k) => (
          <div key={k} className="flex items-center gap-3">
            <input
              type="color"
              aria-label={COLOR_LABELS[k]}
              value={theme.colors[k]}
              onChange={(e) => set({ colors: { ...theme.colors, [k]: e.target.value } })}
              className="h-9 w-12 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-700">{COLOR_LABELS[k]}</div>
              <input
                className="w-24 rounded border border-transparent px-1 font-mono text-xs text-slate-500 hover:border-slate-200 focus:border-indigo-400 focus:outline-none"
                defaultValue={theme.colors[k]}
                key={theme.colors[k]}
                aria-label={`${COLOR_LABELS[k]} hex`}
                onBlur={(e) =>
                  /^#[0-9a-fA-F]{6}$/.test(e.target.value) &&
                  set({ colors: { ...theme.colors, [k]: e.target.value.toLowerCase() } })
                }
              />
            </div>
          </div>
        ))}
        {issues.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
          >
            <div className="mb-1 flex items-center gap-1 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" /> Low contrast — some visitors may struggle to
              read this
            </div>
            <ul className="list-disc pl-4">
              {issues.map((i) => (
                <li key={i.pair}>
                  {i.pair}: {i.ratio}:1
                </li>
              ))}
            </ul>
          </div>
        )}
      </Group>
      <Group title="Typography">
        <div className="grid gap-2">
          {FONT_PAIRS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => set({ fontPair: f.key })}
              aria-pressed={theme.fontPair === f.key}
              className={cn(
                'rounded-xl border px-3 py-2 text-left transition-colors',
                theme.fontPair === f.key
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 hover:border-slate-300'
              )}
            >
              <div
                className="text-sm font-semibold text-slate-900"
                style={{ fontFamily: `var(${f.headingVar}), ui-sans-serif` }}
              >
                {f.label}
              </div>
              <div className="text-xs text-slate-500">{f.description}</div>
            </button>
          ))}
        </div>
      </Group>
      <Group title="Shape & spacing">
        <Select
          label="Corners"
          value={theme.radius}
          onChange={(radius) => set({ radius })}
          options={[
            { value: 'none', label: 'Square' },
            { value: 'sm', label: 'Slightly rounded' },
            { value: 'md', label: 'Rounded' },
            { value: 'lg', label: 'Very rounded' },
            { value: 'xl', label: 'Soft' },
          ]}
        />
        <Select
          label="Buttons"
          value={theme.buttonStyle}
          onChange={(buttonStyle) => set({ buttonStyle })}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'outline', label: 'Outline' },
            { value: 'pill', label: 'Pill' },
          ]}
        />
        <Select
          label="Spacing"
          value={theme.density}
          onChange={(density) => set({ density })}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'spacious', label: 'Spacious' },
          ]}
        />
      </Group>
    </div>
  )
}

export function BrandSeoEditor({
  settings,
  onChange,
}: {
  settings: SiteSettings
  onChange: Update
}) {
  const id = React.useId()
  const social = settings.social
  const SOCIAL = ['facebook', 'instagram', 'x', 'linkedin', 'youtube', 'tiktok'] as const
  return (
    <div className="space-y-5">
      <Group title="Brand">
        <div>
          <Label htmlFor={`${id}-name`} hint="leave empty to use the clinic name">
            Site name
          </Label>
          <input
            id={`${id}-name`}
            className={inputCls}
            maxLength={80}
            value={settings.brand.displayName}
            onChange={(e) =>
              onChange({ ...settings, brand: { ...settings.brand, displayName: e.target.value } })
            }
          />
        </div>
        <ImageField
          label="Logo"
          value={settings.brand.logo}
          onChange={(logo) => onChange({ ...settings, brand: { ...settings.brand, logo } })}
        />
        <ImageField
          label="Favicon (square)"
          value={settings.brand.favicon}
          onChange={(favicon) => onChange({ ...settings, brand: { ...settings.brand, favicon } })}
        />
      </Group>
      <Group title="Announcement bar">
        <Toggle
          label="Show announcement"
          checked={settings.announcement.enabled}
          onChange={(enabled) =>
            onChange({ ...settings, announcement: { ...settings.announcement, enabled } })
          }
        />
        {settings.announcement.enabled && (
          <>
            <input
              className={inputCls}
              maxLength={160}
              aria-label="Announcement text"
              value={settings.announcement.text}
              onChange={(e) =>
                onChange({
                  ...settings,
                  announcement: { ...settings.announcement, text: e.target.value },
                })
              }
            />
            <Toggle
              label="Link it somewhere"
              checked={!!settings.announcement.link}
              onChange={(on) =>
                onChange({
                  ...settings,
                  announcement: {
                    ...settings.announcement,
                    link: on ? { kind: 'route', route: 'services' } : null,
                  },
                })
              }
            />
            {settings.announcement.link && (
              <LinkPicker
                value={settings.announcement.link as SiteLink}
                onChange={(link) =>
                  onChange({ ...settings, announcement: { ...settings.announcement, link } })
                }
              />
            )}
          </>
        )}
      </Group>
      <Group title="Search engines">
        <div>
          <Label htmlFor={`${id}-suffix`} hint="added after every page title">
            Title suffix
          </Label>
          <input
            id={`${id}-suffix`}
            className={inputCls}
            maxLength={80}
            value={settings.seo.titleSuffix}
            placeholder="e.g. | Physiotherapy in Springfield"
            onChange={(e) =>
              onChange({ ...settings, seo: { ...settings.seo, titleSuffix: e.target.value } })
            }
          />
        </div>
        <div>
          <Label htmlFor={`${id}-desc`} hint={`${settings.seo.description.length}/300`}>
            Default description
          </Label>
          <textarea
            id={`${id}-desc`}
            className={inputCls}
            rows={3}
            maxLength={300}
            value={settings.seo.description}
            onChange={(e) =>
              onChange({ ...settings, seo: { ...settings.seo, description: e.target.value } })
            }
          />
        </div>
        <ImageField
          label="Social sharing image"
          value={settings.seo.ogImage}
          onChange={(ogImage) => onChange({ ...settings, seo: { ...settings.seo, ogImage } })}
        />
      </Group>
      <Group title="Social links">
        {SOCIAL.map((k) => (
          <div key={k}>
            <Label htmlFor={`${id}-${k}`}>
              {k === 'x' ? 'X (Twitter)' : k[0]!.toUpperCase() + k.slice(1)}
            </Label>
            <input
              id={`${id}-${k}`}
              className={inputCls}
              placeholder="https://"
              defaultValue={social[k] ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim()
                const next = { ...social }
                if (v.startsWith('https://')) next[k] = v
                else delete next[k]
                onChange({ ...settings, social: next })
              }}
            />
          </div>
        ))}
      </Group>
    </div>
  )
}

function NavItemsEditor({
  items,
  onChange,
  max,
}: {
  items: NavItem[]
  onChange: (v: NavItem[]) => void
  max: number
}) {
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 flex items-center gap-1">
            <input
              className={inputCls}
              value={item.label}
              maxLength={40}
              aria-label={`Menu item ${i + 1} label`}
              onChange={(e) =>
                onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <button
              type="button"
              onClick={() => move(i, -1)}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label="Move up"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label="Move down"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Remove menu item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <LinkPicker
            value={item.link as SiteLink}
            onChange={(link) => onChange(items.map((x, j) => (j === i ? { ...x, link } : x)))}
          />
        </div>
      ))}
      {items.length < max && (
        <button
          type="button"
          onClick={() =>
            onChange([...items, { label: 'New link', link: { kind: 'route', route: 'services' } }])
          }
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
        >
          <Plus className="h-4 w-4" /> Add menu item
        </button>
      )}
    </div>
  )
}

export function HeaderFooterEditor({
  settings,
  onChange,
}: {
  settings: SiteSettings
  onChange: Update
}) {
  const h = settings.header
  const f = settings.footer
  const id = React.useId()
  return (
    <div className="space-y-5">
      <Group title="Header">
        <Select
          label="Layout"
          value={h.variant}
          onChange={(variant) => onChange({ ...settings, header: { ...h, variant } })}
          options={[
            { value: 'classic', label: 'Logo left, menu right' },
            { value: 'centered', label: 'Centered logo' },
            { value: 'minimal', label: 'Minimal (menu button)' },
          ]}
        />
        <Toggle
          label="Stick to the top when scrolling"
          checked={h.sticky}
          onChange={(sticky) => onChange({ ...settings, header: { ...h, sticky } })}
        />
        <Label>Menu</Label>
        <NavItemsEditor
          items={h.links}
          max={8}
          onChange={(links) => onChange({ ...settings, header: { ...h, links } })}
        />
        <CtaEditor
          label="Header button"
          value={h.cta}
          onChange={(cta) => onChange({ ...settings, header: { ...h, cta } })}
        />
      </Group>
      <Group title="Footer">
        <Select
          label="Layout"
          value={f.variant}
          onChange={(variant) => onChange({ ...settings, footer: { ...f, variant } })}
          options={[
            { value: 'columns', label: 'Link columns' },
            { value: 'simple', label: 'Simple' },
          ]}
        />
        <div>
          <Label htmlFor={`${id}-ft`}>Footer text</Label>
          <textarea
            id={`${id}-ft`}
            className={inputCls}
            rows={2}
            maxLength={500}
            value={f.text}
            onChange={(e) => onChange({ ...settings, footer: { ...f, text: e.target.value } })}
          />
        </div>
        {f.variant === 'columns' && (
          <div className="space-y-3">
            {f.columns.map((col, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="mb-2 flex gap-1">
                  <input
                    className={inputCls}
                    value={col.title}
                    maxLength={40}
                    aria-label={`Column ${i + 1} title`}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        footer: {
                          ...f,
                          columns: f.columns.map((c, j) =>
                            j === i ? { ...c, title: e.target.value } : c
                          ),
                        },
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...settings,
                        footer: { ...f, columns: f.columns.filter((_, j) => j !== i) },
                      })
                    }
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove column"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <NavItemsEditor
                  items={col.links}
                  max={8}
                  onChange={(links) =>
                    onChange({
                      ...settings,
                      footer: {
                        ...f,
                        columns: f.columns.map((c, j) => (j === i ? { ...c, links } : c)),
                      },
                    })
                  }
                />
              </div>
            ))}
            {f.columns.length < 4 && (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...settings,
                    footer: { ...f, columns: [...f.columns, { title: 'Links', links: [] }] },
                  })
                }
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
              >
                <Plus className="h-4 w-4" /> Add column
              </button>
            )}
          </div>
        )}
      </Group>
    </div>
  )
}
