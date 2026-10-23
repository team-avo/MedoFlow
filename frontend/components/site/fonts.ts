/**
 * Fonts for clinic sites (theme font pairs, lib/site/theme.ts). Self-hosted
 * from app/fonts/site (SIL OFL 1.1 — licences alongside): the latin woff2s
 * Google Fonts serves, kept in the repo so `next build` never downloads fonts
 * (next/font/google could crash the build — see app/layout.tsx).
 * `preload: false` so a page only downloads the faces its theme uses.
 * (next/font needs literal options at every call — no shared spread.)
 */
import localFont from 'next/font/local'

const nunito = localFont({
  src: '../../app/fonts/site/nunito-latin-wght.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  preload: false,
  variable: '--font-site-nunito',
})
const nunitoSans = localFont({
  src: '../../app/fonts/site/nunito-sans-latin-wght.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  preload: false,
  variable: '--font-site-nunito-sans',
})
const playfair = localFont({
  src: '../../app/fonts/site/playfair-display-latin-wght.woff2',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
  variable: '--font-site-playfair',
})
const sourceSans = localFont({
  src: '../../app/fonts/site/source-sans-3-latin-wght.woff2',
  weight: '200 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  variable: '--font-site-source-sans',
})
const lora = localFont({
  src: '../../app/fonts/site/lora-latin-wght.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
  variable: '--font-site-lora',
})
const poppins = localFont({
  src: [
    { path: '../../app/fonts/site/poppins-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../../app/fonts/site/poppins-latin-600.woff2', weight: '600', style: 'normal' },
    { path: '../../app/fonts/site/poppins-latin-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  preload: false,
  variable: '--font-site-poppins',
})
const fraunces = localFont({
  src: '../../app/fonts/site/fraunces-latin-wght.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
  variable: '--font-site-fraunces',
})
const workSans = localFont({
  src: '../../app/fonts/site/work-sans-latin-wght.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  variable: '--font-site-work-sans',
})

/** Class names that define every site font variable; put on the site root. */
export const siteFontVariables = [
  nunito,
  nunitoSans,
  playfair,
  sourceSans,
  lora,
  poppins,
  fraunces,
  workSans,
]
  .map((f) => f.variable)
  .join(' ')
