/**
 * Website images (B8.5): logos, hero images, galleries. They are public by
 * design, so they live in a separate public bucket (SITE_ASSETS_BUCKET,
 * served from SITE_ASSETS_PUBLIC_BASE_URL) — never the patient-files bucket.
 * Same presigned flow as patient files: intent → browser PUT → complete,
 * where complete checks the stored bytes really are the declared image type.
 */
import type { SiteAsset } from '@prisma/client'
import prisma from '../../config/prisma'
import {
  isS3Configured,
  LocalFileStorage,
  S3FileStorage,
  type FileStorageDriver,
} from '../../services/fileStorage'
import { createS3Client } from '../../services/fileStorage/s3Driver'
import { contentMatchesMime } from '../../utils/fileSniff'
import type { AllowedMime } from '../../config/fileConstants'
import { apiPublicOrigin, siteAssetsBucket, siteAssetsPublicBase } from '../config'
import { siteEntitlements } from '../entitlements'
import { siteError, notFound } from '../errors'
import { auditSite, type SiteActor } from '../actor'

export const SITE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type SiteImageType = (typeof SITE_IMAGE_TYPES)[number]
export const SITE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const EXT: Record<SiteImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
export const SITE_ASSET_ROUTE = '/api/v1/public/sites/assets'

let override: FileStorageDriver | null = null
let local: LocalFileStorage | null = null
let s3: S3FileStorage | null = null

/** Test seam (null restores). */
export function setSiteAssetStorageForTests(d: FileStorageDriver | null) {
  override = d
}

function storage(): FileStorageDriver {
  if (override) return override
  if (isS3Configured()) {
    const bucket = siteAssetsBucket()
    if (!bucket || !siteAssetsPublicBase()) {
      throw siteError(
        503,
        'site_assets_unconfigured',
        'Website image storage is not configured (SITE_ASSETS_BUCKET / SITE_ASSETS_PUBLIC_BASE_URL)'
      )
    }
    return (s3 ??= new S3FileStorage(createS3Client(), bucket))
  }
  if (process.env.NODE_ENV === 'production') {
    throw siteError(503, 'site_assets_unconfigured', 'Website image storage is not configured')
  }
  return (local ??= new LocalFileStorage())
}

export const assetKey = (clinicId: string, assetId: string, mime: SiteImageType) =>
  `site-assets/${clinicId}/${assetId}.${EXT[mime]}`

/** The permanent public URL of an available asset. */
export function assetPublicUrl(a: Pick<SiteAsset, 'clinicId' | 'storageKey'>): string {
  const base = siteAssetsPublicBase()
  if (base && isS3Configured()) return `${base}/${a.storageKey}`
  const file = a.storageKey.split('/').pop()!
  return `${apiPublicOrigin()}${SITE_ASSET_ROUTE}/${a.clinicId}/${file}`
}

/** Reads width/height from PNG, GIF, WebP and JPEG headers. */
export function imageSize(head: Buffer): { width: number; height: number } | null {
  if (head.length >= 24 && head.readUInt32BE(0) === 0x89504e47) {
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
  }
  if (head.length >= 10 && head.toString('ascii', 0, 3) === 'GIF') {
    return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) }
  }
  if (head.length >= 30 && head.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = head.toString('ascii', 12, 16)
    if (chunk === 'VP8X') {
      return { width: 1 + head.readUIntLE(24, 3), height: 1 + head.readUIntLE(27, 3) }
    }
    if (chunk === 'VP8 ') {
      return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff }
    }
    if (chunk === 'VP8L') {
      const b = head.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
  }
  if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8) {
    let i = 2
    while (i + 9 < head.length) {
      if (head[i] !== 0xff) return null
      const marker = head[i + 1]!
      const len = head.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: head.readUInt16BE(i + 5), width: head.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  return null
}

function publicAsset(a: SiteAsset) {
  return {
    id: a.id,
    url: a.status === 'AVAILABLE' ? assetPublicUrl(a) : null,
    mimeType: a.mimeType,
    size: a.size,
    width: a.width,
    height: a.height,
    alt: a.alt,
    status: a.status,
    createdAt: a.createdAt,
  }
}

export async function listAssets(clinicId: string) {
  const rows = await prisma.siteAsset.findMany({
    where: { clinicId, status: 'AVAILABLE' },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return rows.map(publicAsset)
}

export async function createUploadIntent(
  actor: SiteActor,
  input: { mimeType: string; size: number; alt?: string },
  /** Origin the browser reached this API on (local-driver upload URLs). */
  baseUrl: string = apiPublicOrigin()
) {
  const mime = input.mimeType.toLowerCase() as SiteImageType
  if (!SITE_IMAGE_TYPES.includes(mime)) {
    throw siteError(415, 'site_asset_type', 'Upload a JPEG, PNG, WebP or GIF image')
  }
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > SITE_IMAGE_MAX_BYTES) {
    throw siteError(413, 'site_asset_size', 'Images can be up to 5 MB')
  }
  const { clinicId } = actor
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId },
    select: { tenant: { select: { plan: true } } },
  })
  const { maxAssets } = siteEntitlements(clinic?.tenant.plan)
  const count = await prisma.siteAsset.count({ where: { clinicId, status: 'AVAILABLE' } })
  if (count >= maxAssets) {
    throw siteError(402, 'site_asset_limit', `Your plan allows ${maxAssets} images`)
  }
  const driver = storage()
  const asset = await prisma.siteAsset.create({
    data: {
      clinicId,
      storageKey: '',
      mimeType: mime,
      size: input.size,
      alt: (input.alt ?? '').slice(0, 200),
      uploadedById: actor.userId,
    },
  })
  const key = assetKey(clinicId, asset.id, mime)
  await prisma.siteAsset.update({ where: { id: asset.id, clinicId }, data: { storageKey: key } })
  const upload = await driver.createUploadUrl(key, {
    contentType: mime,
    contentLength: input.size,
    expiresIn: 300,
    baseUrl,
  })
  return { assetId: asset.id, upload }
}

export async function completeUpload(actor: SiteActor, id: string) {
  const { clinicId } = actor
  const asset = await prisma.siteAsset.findFirst({ where: { id, clinicId } })
  if (!asset) throw notFound('Image')
  if (asset.status === 'AVAILABLE') return publicAsset(asset)
  const driver = storage()
  const head = await driver.head(asset.storageKey)
  const reject = async (msg: string) => {
    await prisma.siteAsset.update({ where: { id, clinicId }, data: { status: 'REJECTED' } })
    if (head) await driver.delete(asset.storageKey).catch(() => undefined)
    throw siteError(422, 'site_asset_rejected', msg)
  }
  if (!head) return reject('The upload did not arrive — please try again')
  if (head.size !== asset.size) return reject('The uploaded file size does not match')
  const bytes = await driver.readHead(asset.storageKey, 64 * 1024)
  if (!contentMatchesMime(bytes, asset.mimeType as AllowedMime, head.size)) {
    return reject('That file is not the image type it claims to be')
  }
  const dims = imageSize(bytes)
  const done = await prisma.siteAsset.update({
    where: { id, clinicId },
    data: {
      status: 'AVAILABLE',
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      url: null,
    },
  })
  await auditSite(actor, {
    entityType: 'SiteAsset',
    entityId: id,
    action: 'SITE_ASSET_UPLOADED',
    newValue: { mimeType: asset.mimeType, size: asset.size },
  })
  return publicAsset(done)
}

export async function updateAssetAlt(actor: SiteActor, id: string, alt: string) {
  const asset = await prisma.siteAsset.findFirst({ where: { id, clinicId: actor.clinicId } })
  if (!asset) throw notFound('Image')
  const row = await prisma.siteAsset.update({
    where: { id, clinicId: actor.clinicId },
    data: { alt: alt.slice(0, 200) },
  })
  return publicAsset(row)
}

/** Ids of assets referenced by any page (draft or live) or site setting. */
async function assetsInUse(clinicId: string): Promise<Set<string>> {
  const [pages, site] = await Promise.all([
    prisma.sitePage.findMany({
      where: { clinicId },
      select: { sectionsJson: true, draftSectionsJson: true, ogImageAssetId: true },
    }),
    prisma.site.findUnique({
      where: { clinicId },
      select: { settingsDraftJson: true, settingsPublishedJson: true },
    }),
  ])
  const blob = JSON.stringify([pages, site])
  const ids = new Set<string>()
  for (const m of blob.matchAll(/"(?:assetId|ogImageAssetId)":"([A-Za-z0-9_-]+)"/g)) ids.add(m[1]!)
  return ids
}

export async function deleteAsset(actor: SiteActor, id: string) {
  const { clinicId } = actor
  const asset = await prisma.siteAsset.findFirst({ where: { id, clinicId } })
  if (!asset) throw notFound('Image')
  if ((await assetsInUse(clinicId)).has(id)) {
    throw siteError(
      409,
      'site_asset_in_use',
      'This image is used on your site — remove it there first'
    )
  }
  await storage()
    .delete(asset.storageKey)
    .catch(() => undefined)
  await prisma.siteAsset.delete({ where: { id, clinicId } })
  await auditSite(actor, { entityType: 'SiteAsset', entityId: id, action: 'SITE_ASSET_DELETED' })
}

/** id → public URL for the given ids (AVAILABLE only), for the renderer. */
export async function assetUrlMap(clinicId: string, ids: Iterable<string>) {
  const list = [...new Set(ids)]
  if (!list.length)
    return new Map<string, { url: string; width: number | null; height: number | null }>()
  const rows = await prisma.siteAsset.findMany({
    where: { clinicId, id: { in: list }, status: 'AVAILABLE' },
  })
  return new Map(
    rows.map((r) => [r.id, { url: assetPublicUrl(r), width: r.width, height: r.height }])
  )
}

/** Local-driver serving (dev/CI): the bytes of an AVAILABLE asset. */
export async function readLocalAsset(clinicId: string, file: string) {
  const m = /^([A-Za-z0-9_-]{8,40})\.(jpg|png|webp|gif)$/.exec(file)
  if (!m) return null
  const asset = await prisma.siteAsset.findFirst({
    where: { clinicId, id: m[1]!, status: 'AVAILABLE' },
  })
  if (!asset) return null
  const driver = storage()
  if (!(driver instanceof LocalFileStorage)) return null
  const head = await driver.head(asset.storageKey)
  if (!head) return null
  return { asset, body: await driver.readHead(asset.storageKey, head.size) }
}
