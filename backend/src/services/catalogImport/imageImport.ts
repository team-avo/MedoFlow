/**
 * CTO-40: re-hosts an imported product photo in the clinic's own image
 * library (SiteAsset), so the storefront never hot-links a third party.
 * The fetch goes through the SSRF guard; the type comes from the bytes.
 * Any failure is reported as a note on the row and the product is still
 * imported, just without a photo.
 */
import { createAssetFromBytes, SITE_IMAGE_MAX_BYTES } from '../../site/services/assetService'
import { safeRequest } from './safeHttp'
import { ImportSourceError } from './types'

export type ImageResult = { assetId: string } | { skipped: string }

export async function importProductImage(
  clinicId: string,
  userId: string,
  url: string,
  alt: string
): Promise<ImageResult> {
  try {
    const res = await safeRequest(url, {
      timeoutMs: 15_000,
      maxBytes: SITE_IMAGE_MAX_BYTES,
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8' },
    })
    if (res.status !== 200) return { skipped: 'The image could not be downloaded' }
    const asset = await createAssetFromBytes(clinicId, userId, res.body, alt)
    return asset
      ? { assetId: asset.id }
      : { skipped: 'The image is not a JPEG, PNG, WebP or GIF, or the image limit is reached' }
  } catch (err) {
    if (err instanceof ImportSourceError) return { skipped: err.message }
    return { skipped: 'The image could not be stored' }
  }
}
