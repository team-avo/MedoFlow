/**
 * CTO-40: a small RFC 4180 CSV reader (no dependency). Handles a UTF-8 BOM,
 * quoted fields with commas, quotes and line breaks, CRLF, and comma,
 * semicolon or tab delimiters (picked from the header line).
 */

export const MAX_ROWS = 5_000
export const MAX_COLUMNS = 200

const DELIMITERS = [',', ';', '\t'] as const

/** The delimiter used most often outside quotes on the first line. */
export function detectDelimiter(text: string): string {
  let inQuotes = false
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]))
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break
    else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1)
  }
  let best = ','
  let bestCount = 0
  for (const [d, n] of counts) {
    if (n > bestCount) {
      best = d
      bestCount = n
    }
  }
  return best
}

/**
 * Parses CSV text into rows of strings. Stops after `maxRows` data rows plus
 * the header. Entirely blank lines are skipped.
 */
export function parseCsv(input: string, maxRows = MAX_ROWS): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const delim = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  const endRow = () => {
    row.push(field)
    field = ''
    if (row.length > 1 || row[0] !== '') rows.push(row.slice(0, MAX_COLUMNS))
    row = []
  }

  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"' && field === '') {
      inQuotes = true
      i += 1
    } else if (ch === delim) {
      row.push(field)
      field = ''
      i += 1
    } else if (ch === '\r' || ch === '\n') {
      endRow()
      if (rows.length > maxRows) break
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += ch
      i += 1
    }
  }
  if (field !== '' || row.length > 0) endRow()
  return rows.slice(0, maxRows + 1)
}
