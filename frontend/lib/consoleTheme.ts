/**
 * The clinic's brand colour in the staff console (CTO-28).
 *
 * Staff dashboards use the brand primary as their accent (primary buttons,
 * the active sidebar item, focus rings) through CSS variables. Layout and
 * semantic colours (success, warning, error) are untouched. Text on the
 * accent always passes WCAG AA: a colour that fails gets a safe tint
 * (lib/brandColors). Platform-admin pages and patient pages keep MedoFlow's
 * colours (patients see the clinic's website branding, as before).
 *
 * No flash on load: the colour arrives with the session (/auth/me), and the
 * last one is cached in sessionStorage and applied before the first paint.
 */
import { accentOnDark, fromHex, readableAccent, shiftLightness } from '@/lib/brandColors'
import type { User } from '@/lib/types'

/** Brand.primaryColor's schema default: "not chosen yet". */
const UNSET_BRAND = '#6366f1'
const STORAGE_KEY = 'medoflow:console-theme'
const STAFF_ROLES = new Set([
  'SUPER_ADMIN',
  'FRONT_DESK',
  'PROVIDER',
  'STAFF',
  'MARKETING',
  'ACCOUNTING',
])

export type ConsoleTheme = Record<string, string>

const rgb = (hex: string) => fromHex(hex).join(' ')

function hslString(hex: string) {
  const [r, g, b] = fromHex(hex).map((c) => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** CSS variables for a brand colour, or null to keep MedoFlow's defaults. */
export function computeConsoleTheme(primary: string | null | undefined): ConsoleTheme | null {
  if (!primary || !/^#[0-9a-f]{6}$/i.test(primary) || primary.toLowerCase() === UNSET_BRAND) {
    return null
  }
  const { accent, foreground } = readableAccent(primary.toLowerCase())
  return {
    '--brand-rgb': rgb(accent),
    '--brand-foreground-rgb': rgb(foreground),
    '--brand-strong-rgb': rgb(shiftLightness(accent, -0.08)),
    '--brand-soft-rgb': rgb(shiftLightness(accent, 0.45)),
    '--brand-on-dark-rgb': rgb(accentOnDark(accent)),
    '--console-primary-rgb': rgb(accent),
    '--console-primary-foreground-rgb': rgb(foreground),
    '--ring': hslString(accent),
  }
}

/** The theme for this signed-in user: staff of a clinic with a brand colour only. */
export function consoleThemeFor(
  user:
    | (Pick<User, 'role'> & {
        clinic?: { tenant?: { brand?: { primaryColor: string | null } | null } } | null
      })
    | null
): ConsoleTheme | null {
  if (!user || !STAFF_ROLES.has(user.role)) return null
  return computeConsoleTheme(user.clinic?.tenant?.brand?.primaryColor)
}

const VAR_NAMES = Object.keys(computeConsoleTheme('#0d9488')!)

/** Sets (or, with null, removes) the variables on <html>, and remembers them. */
export function applyConsoleTheme(theme: ConsoleTheme | null) {
  if (typeof document === 'undefined') return
  const style = document.documentElement.style
  for (const name of VAR_NAMES) style.removeProperty(name)
  if (theme) for (const [name, value] of Object.entries(theme)) style.setProperty(name, value)
  try {
    if (theme) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(theme))
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable: the session payload still applies it
  }
}

/** Before the first paint on a reload: the last theme this tab used, if any. */
export function applyCachedConsoleTheme() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw) applyConsoleTheme(JSON.parse(raw) as ConsoleTheme)
  } catch {
    // ignore
  }
}
