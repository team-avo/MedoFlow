# MedoFlow UI components

Two layers. Reach for the **app kit** first; drop to **primitives** only when you need to compose something the kit doesn't cover.

## Layers

| Folder                  | What it is                                                             | Use it for                                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui-system/` | **Branded app kit** (`App*`). Opinionated, themed, batteries-included. | Everything in product screens: `AppButton`, `AppInput`, `AppSelect`, `AppFormField`, `AppCard`, `AppTable`, `AppModal`, `AppPageHeader`, `AppSection`, `AppEmptyState`, `AppErrorState`, `LoadingSkeleton`, `KPIStatCard`, `AppBadge`, `AppGrid`, `AppCalendar`, `DateRangeFilter`. |
| `components/ui/`        | **Primitives** (shadcn/Radix). Unbranded building blocks.              | Composing new kit components, or low-level cases. Prefer the `App*` wrapper if one exists.                                                                                                                                                                                          |

Rule of thumb: **screens import from `@/components/ui-system`**; the kit imports from `@/components/ui`.

## Design tokens (canonical)

Colors come from `tailwind.config.ts` (CSS vars in `app/globals.css`). Do **not** hard-code hex values in components — use the token classes.

| Token                                           | Value                                                             | Use                                              |
| ----------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| `primary`                                       | navy `#1E3A5F`                                                    | brand structure, headings-on-light               |
| `accent`                                        | teal `#0D9488` (scale 50–950)                                     | **focus rings, selection, links, active states** |
| `console`                                       | navy by default, **follows the clinic brand** at runtime (CTO-28) | primary buttons in the staff console             |
| `brand`                                         | clinic brand accent at runtime (teal default)                     | console accents                                  |
| `success` / `warning` / `destructive`(`danger`) | semantic                                                          | status only, never as the accent                 |
| `muted` / `subtle` / `border`                   | neutrals                                                          | surfaces, hairlines                              |

### Radius

`rounded-[12px]` (== tailwind `rounded-lg`) for inputs, selects, cards. `theme.ts` mirrors this (`lg 12 / md 10 / sm 8`).

### Focus & interaction convention

- **Focus ring is always accent:** `focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20` (controls), `focus-visible:ring-accent/30` (buttons/tabs/overlays). No more `ring-ring`.
- **Hover tint** for subtle controls: `hover:bg-accent/10 hover:text-accent-700`.
- **Borders:** `border-slate-200/80`, `hover:border-slate-300`.
- **Motion:** interactive elements use `transition-colors`; keep transitions subtle and honour `prefers-reduced-motion` for anything larger than a color/opacity change.

## Patterns

- **Form field:** wrap a control in `AppFormField` (label, description, error) and use `AppInput` / `AppSelect` / `Textarea`. `AppSelect` takes `options`, `value`, `onValueChange`, plus `label`/`error`.
- **Data screen states:** show `LoadingSkeleton` while loading, `AppEmptyState` when there's nothing, `AppErrorState` on failure. Every list/table screen should handle all three.
- **Page shell:** `AppPageHeader` (title + actions) then `AppSection`/`AppCard` blocks.
- **Toasts:** `useAppToast()` → `success` / `error` / `info` / `warning`. Don't call `sonner` directly.

## Notes

- Primitives `button`, `input`, `textarea`, `checkbox`, `tabs`, `select` are already themed onto these tokens (UI-02 / UI-03); raw usage inherits the branded look.
- The app is currently **light-first**; a full dark-mode pass is tracked separately (UI-06).
