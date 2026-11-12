/** CTO-27: the server's own check on uploaded logos (the browser sanitises first). */
import { describe, expect, it } from 'vitest'
import { isSafeLogoDataUrl } from '../services/onboardingService'

const svg = (body: string) => `data:image/svg+xml;base64,${Buffer.from(body).toString('base64')}`

describe('isSafeLogoDataUrl', () => {
  it('accepts raster logos, plain SVGs and https URLs', () => {
    expect(isSafeLogoDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(
      isSafeLogoDataUrl(
        svg('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" fill="#0d9488"/></svg>')
      )
    ).toBe(true)
    expect(isSafeLogoDataUrl('https://cdn.example.test/logo.png')).toBe(true)
  })
  it('refuses scripts, handlers, foreign objects, javascript: links and other types', () => {
    expect(isSafeLogoDataUrl(svg('<svg><script>alert(1)</script></svg>'))).toBe(false)
    expect(isSafeLogoDataUrl(svg('<svg onload="alert(1)"></svg>'))).toBe(false)
    expect(isSafeLogoDataUrl(svg('<svg><foreignObject><div/></foreignObject></svg>'))).toBe(false)
    expect(isSafeLogoDataUrl(svg('<svg><a href="javascript:alert(1)">x</a></svg>'))).toBe(false)
    expect(isSafeLogoDataUrl('data:text/html;base64,PGgxPg==')).toBe(false)
  })
})
