/** sitemap.xml and robots.txt bodies for clinic sites. */

const escapeXml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!
  )

export function sitemapXml(entries: { loc: string; lastmod?: string }[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : ''}</url>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Index a live clinic host; refuse everything when the host isn't a site. */
export function robotsTxt(canonicalBase: string | null): string {
  if (!canonicalBase) return 'User-agent: *\nDisallow: /\n'
  const base = canonicalBase.replace(/\/+$/, '')
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /preview/',
    'Disallow: /checkout',
    'Disallow: /account',
    'Disallow: /payment',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n')
}
