/** CTO-28: the console accent follows the clinic brand, for staff only, always readable. */
import { describe, expect, it } from 'vitest'
import { computeConsoleTheme, consoleThemeFor } from '@/lib/consoleTheme'
import { contrastRatio } from '@/lib/site/theme'

const hex = (rgb: string) =>
  `#${rgb
    .split(' ')
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`

const staff = (role: string, primaryColor: string | null) => ({
  role: role as never,
  clinic: { tenant: { brand: { primaryColor } } },
})

describe('console theme', () => {
  it('no brand chosen (or the default) keeps MedoFlow colours', () => {
    expect(computeConsoleTheme(null)).toBeNull()
    expect(computeConsoleTheme('#6366f1')).toBeNull()
    expect(computeConsoleTheme('not-a-colour')).toBeNull()
  })

  it('text on the accent passes AA; a failing colour gets a safe tint', () => {
    for (const brand of ['#14b8a6', '#fde047', '#1e3a5f', '#ef4444']) {
      const t = computeConsoleTheme(brand)!
      const ratio = contrastRatio(hex(t['--brand-rgb']!), hex(t['--brand-foreground-rgb']!))
      expect(ratio, brand).toBeGreaterThanOrEqual(4.5)
      expect(t['--console-primary-rgb']).toBe(t['--brand-rgb'])
    }
    // Light teal is too light for white text, so the accent's text turns dark.
    expect(hex(computeConsoleTheme('#14b8a6')!['--brand-foreground-rgb']!)).toBe('#0f172a')
    // The sidebar gets a tint that stands out on its dark surface.
    const navy = computeConsoleTheme('#1e3a5f')!
    expect(contrastRatio(hex(navy['--brand-on-dark-rgb']!), '#16304f')).toBeGreaterThanOrEqual(3)
  })

  it('staff get it; patients and platform admins keep MedoFlow colours', () => {
    expect(consoleThemeFor(staff('SUPER_ADMIN', '#0d9488'))).not.toBeNull()
    expect(consoleThemeFor(staff('FRONT_DESK', '#0d9488'))).not.toBeNull()
    expect(consoleThemeFor(staff('PATIENT', '#0d9488'))).toBeNull()
    expect(consoleThemeFor(staff('PLATFORM_ADMIN', '#0d9488'))).toBeNull()
    expect(consoleThemeFor(null)).toBeNull()
  })
})
