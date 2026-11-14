# UI Improvement Plan

Owner: Kartik Sharma · Branch: `feat/ui-improvements` · Started: 2026-11-14

Goal: raise the overall polish and consistency of the MedoFlow portal UI, fix the concrete issues raised in the 2026-11-13 demo review, and reduce friction in the heaviest flows (setup/booking). This is a living checklist; each task is tagged `UI-xx` with a priority (P0 ship-now, P1 next, P2 later) and rough size (S/M/L).

## Current state (what we are working with)

- **Two-layer design system.** `components/ui/` holds raw shadcn/Radix primitives; `components/ui-system/` holds the branded app kit (`AppButton`, `AppCard`, `AppInput`, `AppTable`, `AppModal`, `AppPageHeader`, `AppEmptyState`, `AppErrorState`, `LoadingSkeleton`, `KPIStatCard`, etc.) with `theme.ts` tokens.
- **Runtime per-clinic theming** via CSS vars (`lib/consoleTheme.ts`, `lib/brandColors.ts`) with Tailwind token scales.
- **85 screens** total (43 dashboard, 22 public/patient, 10 onboarding, 4 platform, 4 auth, 2 render/handoff).
- **The gap:** the raw primitives still use generic shadcn tokens, not our brand/console tokens. Example: `components/ui/select.tsx` trigger uses `border-input bg-transparent`, and the dropdown content/items have tight default padding. This is the "dropdowns are unthemed and too close to the border" issue from the review.

## Workstreams & tasks

### WS1 — Design-system consistency (foundation, do first)

- [x] **UI-01** `P0 · M` Documented canonical kit, tokens, focus/motion convention in `frontend/components/README.md`. (2026-11-14)
- [x] **UI-02** `P0 · M` Make primitives theme-aware: `input`, `textarea`, `checkbox`, `tabs`, `button` now use brand/console/accent tokens instead of generic `border-input`/`ring-ring`. (2026-11-14)
- [x] **UI-03** `P0 · S` **Themed dropdowns** (the review item): restyle `SelectTrigger` + `SelectContent` to the portal theme, add content and item padding so options are not flush to the border. Reference the Healing Biologix dropdown. Consider an `AppSelect` wrapper in `ui-system`.
- [x] **UI-04** `P1 · S` Realigned `ui-system/theme.ts` tokens to the real design system (accent teal, primary navy, radius 12/10/8); documented the canonical scale in the README. (2026-11-14)
- [x] **UI-05** `P1 · S` All interactive primitives now use the accent focus-ring + slate borders (input/textarea/checkbox/tabs/button/select done in UI-02/03; sheet/dialog/badge swept). No `ring-ring` left in `ui`/`ui-system`. (2026-11-14)
- [ ] **UI-06** `P2 · M` Dark-mode pass. **DEFERRED (decision):** the kit is intentionally light-first (AppInput etc. hard-code white surfaces); a real dark mode is a separate, larger initiative, not a quick token swap. Recommended as its own effort.

### WS2 — Navigation & information architecture

- [~] **UI-07** `P0 · L` Added a shared **Booking setup stepper** (`components/dashboard/BookingSetupSteps.tsx`) rendered on the Disciplines, Services, and Packages screens — a themed 1→2→3 guide that shows the order and lets staff move between the steps without tab-hunting (`usage pathname`, `aria-current`, mobile-scroll). **Contained scope (decision):** a full combined single-screen flow needs product input + live testing; this additive guide delivers the "simpler than tab-hopping" win safely. (2026-11-14)
- [x] **UI-08** `P1 · M` Reviewed `AppSidebar`: active state/grouping/icons/`aria-current` were already themed and consistent; added the missing `<nav aria-label="Primary">` landmark. Mobile drawer already opens/closes cleanly. (2026-11-14)
- [x] **UI-09** `P1 · S` Quick Setup (`SetupChecklist`) now starts collapsed to a slim progress+next-step bar on the Command Center (`defaultCollapsed`); user's open/closed preference still wins. (2026-11-14)
- [x] **UI-10** `P1 · M` Audited the shell rollout (already near-complete). Added `AppPageHeader`/`PageContainer` to the screens that lacked it (settings, packages, memberships). Intentionally kept custom branded heroes (appointments, analytics) and the site-builder sub-shell. (2026-11-14)

### WS3 — Onboarding & setup UX

- [x] **UI-11** `P1 · M` Added a reuse-details toggle + "Add new (blank)" to the practitioner form (prefills shared license state; personal fields stay blank since emails must be unique). The other items were already in place: field is already "Credentials", "Date signed" auto-fills today, signature already uses the logged-in user's name, agreement copy is legal constants (left intact). (2026-11-14)
- [x] **UI-12** `P1 · M` `SetupChecklist` now has an always-visible "Next step" CTA (shows even when collapsed), clearer per-item status (`aria-current="step"`, brand ring on the next item), and an `AppEmptyState` fallback. (2026-11-14)

### WS4 — Component states coverage

- [~] **UI-13** `P1 · M` Added the missing loading/empty/error states (`AppErrorState` + retry, `AppEmptyState`) to packages, memberships, and appointments. **Partial:** a few screens (services, locations) still use ad-hoc spinners and could be swept in a follow-up. (2026-11-14)
- [x] **UI-14** `P2 · S` `useAppToast()` is the one toast API (success/error/info/warning); documented "don't call sonner directly" in the README. (2026-11-14)

### WS5 — Responsive & mobile

- [~] **UI-15** `P1 · L` Mobile nav drawer confirmed working (opens/closes on overlay/Esc/nav-click, labelled hamburger); the booking stepper (UI-07) wraps/scrolls on mobile. **Partial:** a full per-screen mobile audit (tables→cards, tap targets) remains a dedicated follow-up. (2026-11-14)

### WS6 — Accessibility

- [~] **UI-16** `P1 · M` Visible focus is now consistent (accent focus-ring everywhere, UI-02/03/05); added the `<nav>` landmark label and `aria-current` on stepper/checklist. Per-clinic accent already AA-guarded in `brandColors.ts`. **Partial:** a full screen-by-screen axe audit remains a follow-up (the Playwright a11y specs already exist to extend). (2026-11-14)

### WS7 — Theming tool

- [~] **UI-17** `P2 · M` Code review PASSED: `brandColors.ts` extracts a logo palette, forces accents to AA (4.5:1 on white, 3:1 on the dark sidebar), proposes primary/secondary, and sanitizes SVG uploads; it's unit-tested. **Partial:** the live upload-a-logo click-through still needs a manual pass on the running app. (2026-11-14)

### WS8 — Motion & perceived performance

- [x] **UI-18** `P2 · S` Interactive primitives carry `transition-colors`; motion convention (subtle, honour reduced-motion) documented in the README. (2026-11-14)

## Quick wins to ship first (tonight / this week)

1. **UI-03** themed + padded dropdowns.
2. **UI-09** shrink Quick Setup.
3. **UI-02** (partial) theme the most-used inputs/buttons.
4. **UI-11** onboarding field cleanup.

## Rollout order

Audit (UI-01) → tokens & primitives (UI-02/03/04/05) → page shell & nav (UI-08/09/10) → flow simplification (UI-07) → states & responsive & a11y (UI-13/15/16) → polish (UI-06/14/17/18).

## Definition of done (per task)

- Uses kit tokens (no hard-coded colors/spacing), passes `pnpm lint` + `typecheck`, AA contrast holds in light and dark and under a clinic brand color, works at mobile width, and has a before/after screenshot in the PR.

## Notes

- Existing `docs/UI_UX_REDESIGN_PLAN.md` / `_OUTPUT.md` predate this; this plan is the focused, task-level follow-up driven by the 2026-11-13 review. Reconcile with them during UI-01.
