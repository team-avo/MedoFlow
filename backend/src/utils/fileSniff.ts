import type { AllowedMime } from '../config/fileConstants'

/** Bytes needed from the start of an object to recognise every allowed type. */
export const SNIFF_BYTES = 4096

const startsWith = (buf: Buffer, sig: number[], offset = 0): boolean =>
  buf.length >= offset + sig.length && sig.every((b, i) => buf[offset + i] === b)

/**
 * Text files must look like text: no NUL bytes, valid UTF-8, and not an
 * HTML/SVG/XML document smuggled in under text/plain.
 */
function looksLikePlainText(head: Buffer, truncated: boolean): boolean {
  if (head.includes(0)) return false
  // A multi-byte UTF-8 sequence may be cut at the end of a truncated read.
  const sample = truncated ? head.subarray(0, Math.max(0, head.length - 3)) : head
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample)
  } catch {
    return false
  }
  const lead = head.toString('utf8', 0, 512).trimStart().toLowerCase()
  return !/^(<!doctype|<html|<svg|<\?xml|<script)/.test(lead)
}

/**
 * Checks that an object's leading bytes match the content type the uploader
 * declared (B3.1). Declared types are never trusted on their own: a file
 * whose bytes say otherwise is rejected.
 *
 * @param head  the first bytes of the object (up to SNIFF_BYTES)
 * @param size  the object's full size, to know whether `head` is truncated
 */
export function contentMatchesMime(head: Buffer, mime: AllowedMime, size: number): boolean {
  switch (mime) {
    case 'application/pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
    case 'image/png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff])
    case 'image/gif':
      return (
        startsWith(head, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWith(head, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      )
    case 'image/webp':
      return (
        startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)
      )
    case 'text/plain':
    case 'text/csv':
      return looksLikePlainText(head, size > head.length)
    default:
      return false
  }
}
