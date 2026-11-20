/**
 * CTO-40: reads the first worksheet of an .xlsx file into rows of strings,
 * with no dependency: an .xlsx is a ZIP of XML parts, and Node's zlib
 * inflates them. Covers what store exports and seller-panel templates use
 * (shared strings, inline strings, numbers, booleans). Formulas give their
 * cached value. ZIP64, encryption and legacy .xls are rejected.
 *
 * Guards: the uncompressed size of every part is capped, so a ZIP bomb
 * fails fast instead of filling memory.
 */
import zlib from 'zlib'
import { MAX_COLUMNS, MAX_ROWS } from './csv'

export const MAX_PART_BYTES = 40 * 1024 * 1024

export class XlsxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxError'
  }
}

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

/** True when the bytes start like a ZIP (and so possibly an .xlsx). */
export const looksLikeZip = (buf: Buffer) => buf.length >= 4 && buf.readUInt32LE(0) === LOC_SIG

function readEntries(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new XlsxError('This is not a valid Excel (.xlsx) file')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || p === 0xffffffff)
    throw new XlsxError('Large (ZIP64) files are not supported')
  const entries = new Map<string, ZipEntry>()
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) {
      throw new XlsxError('This Excel file is damaged')
    }
    const flags = buf.readUInt16LE(p + 8)
    if (flags & 0x1) throw new XlsxError('Password-protected Excel files are not supported')
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, {
      name,
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      localOffset: buf.readUInt32LE(p + 42),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readPart(buf: Buffer, e: ZipEntry): string {
  if (e.size > MAX_PART_BYTES) throw new XlsxError('This Excel file is too large to import')
  const p = e.localOffset
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOC_SIG) {
    throw new XlsxError('This Excel file is damaged')
  }
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28)
  const data = buf.subarray(start, start + e.compressedSize)
  let out: Buffer
  if (e.method === 0) out = data
  else if (e.method === 8) {
    try {
      out = zlib.inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES })
    } catch {
      throw new XlsxError('This Excel file is damaged or too large')
    }
  } else throw new XlsxError('This Excel file uses an unsupported compression')
  return out.toString('utf8')
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export const decodeXml = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return XML_ENTITIES[code.toLowerCase()] ?? m
  })

/** All <t> text inside a fragment, without phonetic (<rPh>) runs. */
const textOf = (xml: string): string => {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1]
  return decodeXml(out)
}

/** An attribute's value; `name` is a known literal, never input. */
const attr = (attrs: string, name: string): string | null => {
  for (const m of attrs.matchAll(/([\w:]+)="([^"]*)"/g)) if (m[1] === name) return m[2]!
  return null
}

/** "AB12" → 27 (zero-based column). */
export const columnIndex = (ref: string): number => {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

function firstSheetPath(entries: Map<string, ZipEntry>, buf: Buffer): string {
  const wb = entries.get('xl/workbook.xml')
  const rels = entries.get('xl/_rels/workbook.xml.rels')
  if (wb && rels) {
    const sheet = /<sheet\b([^>]*)\/?>/.exec(readPart(buf, wb))
    const rid = sheet ? (attr(sheet[1]!, 'r:id') ?? attr(sheet[1]!, 'id')) : null
    if (rid) {
      for (const m of readPart(buf, rels).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
        if (attr(m[1]!, 'Id') !== rid) continue
        const target = attr(m[1]!, 'Target') ?? ''
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
        if (entries.has(path)) return path
      }
    }
  }
  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml'
  throw new XlsxError('No worksheet found in this Excel file')
}

/** Rows of the first worksheet (header row first), as strings. */
export function readXlsx(buf: Buffer, maxRows = MAX_ROWS): string[][] {
  if (!looksLikeZip(buf)) throw new XlsxError('This is not a valid Excel (.xlsx) file')
  const entries = readEntries(buf)
  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared: string[] = []
  if (sharedEntry) {
    for (const m of readPart(buf, sharedEntry).matchAll(
      /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g
    )) {
      shared.push(m[1] ? textOf(m[1]) : '')
    }
  }
  const sheet = readPart(buf, entries.get(firstSheetPath(entries, buf))!)
  const rows: string[][] = []
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []
    let next = 0
    for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!
      const body = c[2] ?? ''
      const ref = attr(attrs, 'r')
      const col = ref ? columnIndex(ref) : next
      next = col + 1
      if (col < 0 || col >= MAX_COLUMNS) continue
      const type = attr(attrs, 't')
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = textOf(body)
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else if (v !== undefined) value = decodeXml(v)
      while (row.length < col) row.push('')
      row[col] = value
    }
    if (row.some((v) => v.trim() !== '')) rows.push(row)
    if (rows.length > maxRows) break
  }
  return rows
}
