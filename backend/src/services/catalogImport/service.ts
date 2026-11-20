/**
 * CTO-40: the import pipeline.
 *
 *   source → items → staged rows (dry run, PREVIEW_READY) → owner edits →
 *   apply (DONE) → summary
 *
 *  - A store connection is read by a queued job (FETCHING → PREVIEW_READY);
 *    a file is parsed in the request.
 *  - Nothing reaches the catalog before the owner presses Import. Every
 *    imported product is UNCLASSIFIED (not sellable) unless the owner picked
 *    a class for it in the preview.
 *  - Apply is idempotent: each row records the product it wrote, so a retry
 *    after a crash carries on, and importing the same data again is all
 *    UNCHANGED.
 *  - Jobs run on the BullMQ queue when Redis is configured (3 attempts with
 *    backoff), in-process otherwise. They run inside the clinic's tenant
 *    context, so row-level security applies.
 */
import {
  Prisma,
  type CatalogImport,
  type CatalogImportRow,
  type ProductFulfillmentClass,
} from '@prisma/client'
import { Queue, Worker, type Job } from 'bullmq'
import prisma from '../../config/prisma'
import { withTenantContext } from '../../config/tenantContext'
import { idleWorkerOptions, parseRedisUrl } from '../../queues/redisConnection'
import { uniqueEntitySlug } from '../../site/services/slugService'
import * as auditService from '../auditService'
import {
  CONNECTORS,
  credentialsOf,
  getActiveConnection,
  markSynced,
  saveTokenUpdate,
  type Actor,
} from '../storeConnections'
import { parseCsv } from './csv'
import { importProductImage } from './imageImport'
import {
  detectPreset,
  fileToItems,
  FILE_PRESETS,
  type ColumnMapping,
  type FilePreset,
} from './presets'
import {
  countRows,
  stageItems,
  type ExistingProduct,
  type RowDiff,
  type StagedRow,
} from './staging'
import {
  ImportSourceError,
  MAX_IMPORT_ITEMS,
  type ImportSource,
  type NormalizedItem,
  type StoreProvider,
} from './types'
import { looksLikeZip, readXlsx, XlsxError } from './xlsx'

export const QUEUE_NAME = 'catalog-import'
export const CATALOG_IMPORT_ATTEMPTS = 3
export const MAX_FILE_BYTES = 5 * 1024 * 1024
const ROW_CHUNK = 500
const IMAGE_CONCURRENCY = 4

export type ImportStatus = 'FETCHING' | 'PREVIEW_READY' | 'APPLYING' | 'DONE' | 'FAILED'

export interface ImportOptions {
  syncStock: boolean
  syncPrice: boolean
}
const DEFAULT_OPTIONS: ImportOptions = { syncStock: true, syncPrice: true }

const fail = (status: number, message: string, code: string) =>
  Object.assign(new Error(message), { statusCode: status, code })

const optionsOf = (imp: Pick<CatalogImport, 'options'>): ImportOptions => ({
  ...DEFAULT_OPTIONS,
  ...((imp.options as Partial<ImportOptions> | null) ?? {}),
})

const jobContext = (clinicId: string, userId: string | null) => ({
  clinicId,
  tenantId: null,
  userId,
  role: 'SYSTEM',
  allowedClinicIds: [clinicId],
  bypassReason: null,
})

// ─── Reading the clinic's catalog ────────────────────────────────────────────

async function existingProducts(clinicId: string): Promise<ExistingProduct[]> {
  const rows = await prisma.product.findMany({
    where: { clinicId },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      description: true,
      isActive: true,
      fulfillmentClass: true,
      externalSource: true,
      externalId: true,
      imageSourceUrl: true,
      inventoryItem: { select: { quantityInStock: true } },
    },
  })
  return rows.map((r) => ({
    ...r,
    price: Number(r.price),
    stock: r.inventoryItem?.quantityInStock ?? null,
  }))
}

// ─── Staging rows ────────────────────────────────────────────────────────────

const rowData = (
  importId: string,
  clinicId: string,
  r: StagedRow
): Prisma.CatalogImportRowCreateManyInput => ({
  importId,
  clinicId,
  position: r.position,
  externalId: r.externalId,
  name: r.name,
  nameOverride: r.nameOverride,
  sku: r.sku,
  price: r.price,
  description: r.description,
  imageSourceUrl: r.imageSourceUrl,
  stock: r.stock,
  sourceCategory: r.sourceCategory,
  suggestedClass: r.suggestedClass,
  chosenClass: r.chosenClass,
  rxLike: r.rxLike,
  skipped: r.skipped,
  action: r.action,
  matchedProductId: r.matchedProductId,
  matchedBy: r.matchedBy,
  diff: (r.diff ?? Prisma.DbNull) as Prisma.InputJsonValue,
  error: r.error,
})

/**
 * Stages `items` and replaces the import's rows. `ids` (by position) keeps
 * row ids stable across a re-stage, so the preview's edits stay addressable.
 */
async function writeStaged(
  imp: CatalogImport,
  items: NormalizedItem[],
  extraSummary: Record<string, unknown>,
  ids?: string[]
) {
  const rows = stageItems(items, await existingProducts(imp.clinicId), {
    source: imp.source as ImportSource,
    ...optionsOf(imp),
  })
  await prisma.$transaction(
    async (tx) => {
      await tx.catalogImportRow.deleteMany({ where: { importId: imp.id, clinicId: imp.clinicId } })
      for (let i = 0; i < rows.length; i += ROW_CHUNK) {
        await tx.catalogImportRow.createMany({
          data: rows.slice(i, i + ROW_CHUNK).map((r) => ({
            ...rowData(imp.id, imp.clinicId, r),
            ...(ids?.[r.position] ? { id: ids[r.position] } : {}),
          })),
        })
      }
    },
    { timeout: 60_000 }
  )
  return prisma.catalogImport.update({
    where: { id: imp.id, clinicId: imp.clinicId },
    data: {
      status: 'PREVIEW_READY',
      lastError: null,
      summary: { ...extraSummary, counts: countRows(rows) } as Prisma.InputJsonValue,
    },
  })
}

const rowToItem = (
  r: CatalogImportRow
): NormalizedItem & {
  nameOverride: string | null
  skipped: boolean
  chosenClass: ProductFulfillmentClass | null
} => ({
  externalId: r.externalId,
  name: r.name,
  sku: r.sku,
  price: r.price === null ? null : Number(r.price),
  description: r.description,
  imageUrl: r.imageSourceUrl,
  stock: r.stock,
  category: r.sourceCategory,
  tags: [],
  nameOverride: r.nameOverride,
  skipped: r.skipped,
  chosenClass: r.chosenClass,
})

/** Re-runs matching after the owner's edits (renames, skips, classes, options). */
async function restage(imp: CatalogImport) {
  const current = await prisma.catalogImportRow.findMany({
    where: { importId: imp.id, clinicId: imp.clinicId },
    orderBy: { position: 'asc' },
  })
  const summary = (imp.summary as Record<string, unknown> | null) ?? {}
  const { counts: _old, ...rest } = summary
  return writeStaged(
    imp,
    current.map(rowToItem),
    rest,
    current.map((r) => r.id)
  )
}

// ─── Fetching from a store (the job) ─────────────────────────────────────────

export async function runFetch(importId: string, clinicId: string, opts: { final: boolean }) {
  const imp = await prisma.catalogImport.findFirst({ where: { id: importId, clinicId } })
  if (!imp || imp.status !== 'FETCHING' || !imp.storeConnectionId) return imp
  await prisma.catalogImport.update({
    where: { id: imp.id, clinicId },
    data: { attempts: { increment: 1 } },
  })
  try {
    const conn = await getActiveConnection(clinicId, imp.storeConnectionId)
    const connector = CONNECTORS[conn.provider as StoreProvider]
    const creds = credentialsOf(conn)
    const items: NormalizedItem[] = []
    let cursor: string | undefined
    let truncated = false
    for (let page = 0; page < 500; page++) {
      const res = await connector.fetchPage(creds, cursor, async (t) => {
        await saveTokenUpdate(clinicId, conn.id, t)
        creds.accessToken = t.accessToken
        if (t.refreshToken !== undefined) creds.refreshToken = t.refreshToken
        if (t.tokenExpiresAt !== undefined) creds.tokenExpiresAt = t.tokenExpiresAt
      })
      items.push(...res.items)
      cursor = res.next
      if (!cursor) break
      if (items.length >= MAX_IMPORT_ITEMS) {
        truncated = true
        break
      }
    }
    const kept = items.slice(0, MAX_IMPORT_ITEMS)
    const warnings =
      truncated || items.length > MAX_IMPORT_ITEMS
        ? [`Only the first ${MAX_IMPORT_ITEMS} products are imported`]
        : []
    // Products this store sent before that it no longer lists (reported, never removed).
    let missingUpstream: string[] = []
    if (!truncated) {
      const seen = new Set(kept.map((i) => i.externalId))
      const linked = await prisma.product.findMany({
        where: {
          clinicId,
          externalSource: conn.provider,
          isActive: true,
          storeConnectionId: conn.id,
        },
        select: { name: true, externalId: true },
      })
      missingUpstream = linked
        .filter((p) => p.externalId && !seen.has(p.externalId))
        .map((p) => p.name)
    }
    const done = await writeStaged(imp, kept, {
      warnings,
      missingUpstream: { count: missingUpstream.length, names: missingUpstream.slice(0, 20) },
    })
    await markSynced(clinicId, conn.id, null)
    return done
  } catch (err) {
    const safe = err instanceof ImportSourceError || (err as { statusCode?: number }).statusCode
    const reason = safe ? (err as Error).message.slice(0, 200) : 'The store could not be read'
    const permanent = err instanceof ImportSourceError && !err.retryable
    if (!opts.final && !permanent) {
      await prisma.catalogImport.update({
        where: { id: imp.id, clinicId },
        data: { lastError: reason },
      })
      throw err
    }
    if (!safe) console.error('[catalog-import] fetch failed:', (err as Error).message)
    if (imp.storeConnectionId && err instanceof ImportSourceError && err.code === 'unauthorized') {
      await markSynced(clinicId, imp.storeConnectionId, reason).catch(() => undefined)
    }
    return prisma.catalogImport.update({
      where: { id: imp.id, clinicId },
      data: { status: 'FAILED', lastError: reason, summary: { failedPhase: 'fetch' } },
    })
  }
}

// ─── Applying (the job) ──────────────────────────────────────────────────────

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

async function applyRow(
  imp: CatalogImport,
  r: CatalogImportRow,
  now: Date
): Promise<{ productId: string; classified: boolean } | { error: string }> {
  const clinicId = imp.clinicId
  const source = imp.source
  const link = {
    externalSource: source,
    externalId: r.externalId,
    storeConnectionId: imp.storeConnectionId,
    externalSyncedAt: now,
  }
  if (r.action === 'CREATE') {
    const name = r.nameOverride ?? r.name
    try {
      const product = await prisma.product.create({
        data: {
          clinicId,
          name,
          slug: await uniqueEntitySlug('product', clinicId, name),
          description: r.description,
          sku: r.sku,
          price: r.price ?? 0,
          fulfillmentClass: r.chosenClass ?? 'UNCLASSIFIED',
          ...link,
          ...(r.stock !== null
            ? { inventoryItem: { create: { clinicId, quantityInStock: r.stock } } }
            : {}),
        },
        select: { id: true },
      })
      return { productId: product.id, classified: !!r.chosenClass }
    } catch (err) {
      if (isUniqueViolation(err)) return { error: 'A product with this name or id already exists' }
      throw err
    }
  }
  // UPDATE (or UNCHANGED with a class to set).
  const product = await prisma.product.findFirst({
    where: { id: r.matchedProductId ?? '', clinicId },
    select: { id: true, fulfillmentClass: true },
  })
  if (!product) return { error: 'The matching product no longer exists' }
  const diff = (r.diff as RowDiff | null) ?? {}
  const classify = !!r.chosenClass && product.fulfillmentClass === 'UNCLASSIFIED'
  const data: Prisma.ProductUpdateInput = {}
  if (diff.price) data.price = diff.price.to
  if (diff.description && r.description) data.description = r.description
  if (diff.link)
    Object.assign(data, { externalSource: link.externalSource, externalId: link.externalId })
  if (imp.storeConnectionId) data.storeConnection = { connect: { id: imp.storeConnectionId } }
  if (classify) data.fulfillmentClass = r.chosenClass!
  data.externalSyncedAt = now
  try {
    await prisma.product.update({ where: { id: product.id, clinicId }, data })
  } catch (err) {
    if (isUniqueViolation(err)) return { error: 'Another product is already linked to this item' }
    throw err
  }
  if (diff.stock) {
    await prisma.inventoryItem.upsert({
      where: { productId: product.id, clinicId },
      create: { clinicId, productId: product.id, quantityInStock: diff.stock.to },
      update: { quantityInStock: diff.stock.to },
    })
  }
  return { productId: product.id, classified: classify }
}

async function pool<T>(list: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, list.length) }, async () => {
      while (i < list.length) await fn(list[i++]!)
    })
  )
}

export async function runApply(importId: string, clinicId: string, opts: { final: boolean }) {
  const imp = await prisma.catalogImport.findFirst({ where: { id: importId, clinicId } })
  if (!imp || imp.status !== 'APPLYING') return imp
  await prisma.catalogImport.update({
    where: { id: imp.id, clinicId },
    data: { attempts: { increment: 1 } },
  })
  try {
    const now = new Date()
    const rows = await prisma.catalogImportRow.findMany({
      where: {
        importId,
        clinicId,
        skipped: false,
        appliedAt: null,
        OR: [
          { action: { in: ['CREATE', 'UPDATE'] } },
          { action: 'UNCHANGED', chosenClass: { not: null } },
        ],
      },
      orderBy: { position: 'asc' },
    })
    const images: { row: CatalogImportRow; productId: string }[] = []
    for (const r of rows) {
      const res = await applyRow(imp, r, now)
      if ('error' in res) {
        await prisma.catalogImportRow.update({
          where: { id: r.id, clinicId },
          data: { action: 'ERROR', error: res.error, appliedAt: now },
        })
        continue
      }
      await prisma.catalogImportRow.update({
        where: { id: r.id, clinicId },
        data: { appliedProductId: res.productId, appliedAt: now },
      })
      const diff = (r.diff as RowDiff | null) ?? {}
      if (r.imageSourceUrl && (r.action === 'CREATE' || diff.image))
        images.push({ row: r, productId: res.productId })
    }

    // Photos last: slow, and a photo failure never fails the product.
    let imagesImported = 0
    let imagesSkipped = 0
    await pool(images, IMAGE_CONCURRENCY, async ({ row, productId }) => {
      const res = await importProductImage(
        clinicId,
        imp.createdById,
        row.imageSourceUrl!,
        row.nameOverride ?? row.name
      )
      if ('assetId' in res) {
        imagesImported += 1
        await prisma.product.update({
          where: { id: productId, clinicId },
          data: { imageAssetId: res.assetId, imageSourceUrl: row.imageSourceUrl },
        })
      } else {
        imagesSkipped += 1
        const diff = ((row.diff as Record<string, unknown> | null) ?? {}) as Prisma.JsonObject
        await prisma.catalogImportRow.update({
          where: { id: row.id, clinicId },
          data: { diff: { ...diff, imageSkipped: res.skipped } },
        })
      }
    })

    const all = await prisma.catalogImportRow.findMany({
      where: { importId, clinicId },
      select: {
        action: true,
        skipped: true,
        chosenClass: true,
        rxLike: true,
        appliedAt: true,
        appliedProductId: true,
      },
    })
    const applied = all.filter((r) => r.appliedProductId)
    const summary = {
      ...((imp.summary as Record<string, unknown> | null) ?? {}),
      counts: countRows(all),
      result: {
        created: applied.filter((r) => r.action === 'CREATE').length,
        updated: applied.filter((r) => r.action === 'UPDATE' || r.action === 'UNCHANGED').length,
        failed: all.filter((r) => r.action === 'ERROR' && r.appliedAt).length,
        unclassified: applied.filter((r) => r.action === 'CREATE' && !r.chosenClass).length,
        imagesImported,
        imagesSkipped,
      },
    }
    const done = await prisma.catalogImport.update({
      where: { id: imp.id, clinicId },
      data: {
        status: 'DONE',
        appliedAt: now,
        lastError: null,
        summary: summary as Prisma.InputJsonValue,
      },
    })
    await auditService.logAudit({
      clinicId,
      entityType: 'CatalogImport',
      entityId: imp.id,
      action: 'CATALOG_IMPORT_APPLIED',
      newValue: { source: imp.source, preset: imp.preset, ...summary.result },
      performedById: imp.createdById,
    })
    if (imp.storeConnectionId)
      await markSynced(clinicId, imp.storeConnectionId, null).catch(() => undefined)
    return done
  } catch (err) {
    const reason = 'The import stopped part way. Retry to carry on'
    if (!opts.final) {
      await prisma.catalogImport.update({
        where: { id: imp.id, clinicId },
        data: { lastError: reason },
      })
      throw err
    }
    console.error('[catalog-import] apply failed:', (err as Error).message)
    return prisma.catalogImport.update({
      where: { id: imp.id, clinicId },
      data: {
        status: 'FAILED',
        lastError: reason,
        summary: {
          ...((imp.summary as Record<string, unknown> | null) ?? {}),
          failedPhase: 'apply',
        } as Prisma.InputJsonValue,
      },
    })
  }
}

// ─── Queue (Redis) or in-process ─────────────────────────────────────────────

type JobData = {
  kind: 'fetch' | 'apply'
  importId: string
  clinicId: string
  userId: string | null
}

let queue: Pick<Queue, 'add'> | null | undefined
function getQueue(): Pick<Queue, 'add'> | null {
  if (queue !== undefined) return queue
  if (!process.env.REDIS_URL) return (queue = null)
  queue = new Queue(QUEUE_NAME, {
    connection: parseRedisUrl(process.env.REDIS_URL),
    defaultJobOptions: {
      attempts: CATALOG_IMPORT_ATTEMPTS,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: { age: 7 * 24 * 3600, count: 500 },
    },
  })
  return queue
}

/** Tests: run jobs in-process (null), or capture them. */
export function setCatalogImportQueueForTests(q: Pick<Queue, 'add'> | null | undefined) {
  queue = q
}

const runJob = (d: JobData, attempt: number) =>
  withTenantContext(jobContext(d.clinicId, d.userId), () =>
    (d.kind === 'fetch' ? runFetch : runApply)(d.importId, d.clinicId, {
      final: attempt >= CATALOG_IMPORT_ATTEMPTS,
    })
  )

export function createCatalogImportWorker() {
  if (!process.env.REDIS_URL) return null
  return new Worker(QUEUE_NAME, (job: Job<JobData>) => runJob(job.data, job.attemptsMade + 1), {
    connection: parseRedisUrl(process.env.REDIS_URL),
    // Idle polling is the whole Redis bill; see queues/redisConnection.ts.
    ...idleWorkerOptions(),
  })
}

/** Exposed for tests: resolves when an in-process job has finished. */
let inline: Promise<void> = Promise.resolve()
export const waitForInlineImportJobs = () => inline

async function enqueue(d: JobData) {
  const q = getQueue()
  if (q) {
    await q.add(d.kind, d, { jobId: `catalog-import-${d.kind}-${d.importId}-${Date.now()}` })
    return
  }
  const run = async () => {
    for (let attempt = 1; attempt <= CATALOG_IMPORT_ATTEMPTS; attempt++) {
      try {
        await runJob(d, attempt)
        return
      } catch {
        // retried
      }
    }
  }
  inline = inline.then(run, run)
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function publicImport(imp: CatalogImport) {
  return {
    id: imp.id,
    source: imp.source,
    preset: imp.preset,
    storeConnectionId: imp.storeConnectionId,
    status: imp.status as ImportStatus,
    options: optionsOf(imp),
    columnMapping: imp.columnMapping,
    summary: imp.summary,
    attempts: imp.attempts,
    lastError: imp.lastError,
    appliedAt: imp.appliedAt,
    createdAt: imp.createdAt,
    updatedAt: imp.updatedAt,
  }
}

export async function startConnectionImport(
  actor: Actor,
  connectionId: string,
  options?: Partial<ImportOptions>
) {
  const conn = await getActiveConnection(actor.clinicId, connectionId)
  const running = await prisma.catalogImport.findFirst({
    where: {
      clinicId: actor.clinicId,
      storeConnectionId: conn.id,
      status: { in: ['FETCHING', 'APPLYING'] },
    },
  })
  if (running) return publicImport(running)
  const imp = await prisma.catalogImport.create({
    data: {
      clinicId: actor.clinicId,
      source: conn.provider,
      storeConnectionId: conn.id,
      status: 'FETCHING',
      options: { ...DEFAULT_OPTIONS, ...(options ?? {}) },
      createdById: actor.userId,
    },
  })
  await enqueue({ kind: 'fetch', importId: imp.id, clinicId: actor.clinicId, userId: actor.userId })
  return publicImport(imp)
}

/** Parses an uploaded CSV or .xlsx file into a table (header row first). */
export function parseUpload(buffer: Buffer): string[][] {
  if (buffer.length === 0) throw fail(400, 'The file is empty', 'empty_file')
  if (buffer.length > MAX_FILE_BYTES) throw fail(413, 'Files can be up to 5 MB', 'file_too_large')
  if (looksLikeZip(buffer)) {
    try {
      return readXlsx(buffer)
    } catch (err) {
      if (err instanceof XlsxError) throw fail(400, err.message, 'invalid_xlsx')
      throw err
    }
  }
  // Legacy .xls (OLE compound file) and other binaries.
  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw fail(400, 'Save the file as .xlsx or .csv and upload it again', 'legacy_xls')
  }
  const text = buffer.toString('utf8')
  if (text.includes('\u0000')) throw fail(400, 'Upload a CSV or Excel (.xlsx) file', 'not_csv')
  return parseCsv(text)
}

export async function createFileImport(
  actor: Actor,
  input: {
    buffer: Buffer
    preset?: string
    mapping?: ColumnMapping
    options?: Partial<ImportOptions>
  }
) {
  const table = parseUpload(input.buffer)
  if (table.length < 2) throw fail(400, 'The file has no product rows', 'no_rows')
  const headers = table[0]!.map((h) => h.trim())
  const detected = detectPreset(headers)
  const preset: FilePreset =
    input.preset &&
    (FILE_PRESETS as readonly string[]).includes(input.preset) &&
    input.preset !== 'auto'
      ? (input.preset as FilePreset)
      : detected
  const parsed = fileToItems(table, preset, input.mapping)
  const imp = await prisma.catalogImport.create({
    data: {
      clinicId: actor.clinicId,
      source: 'CSV',
      preset,
      status: 'FETCHING',
      columnMapping: parsed.mapping as Prisma.InputJsonValue,
      options: { ...DEFAULT_OPTIONS, ...(input.options ?? {}) },
      createdById: actor.userId,
    },
  })
  const staged = await writeStaged(imp, parsed.items, {
    warnings: parsed.warnings,
    headers: headers.slice(0, 100),
    detectedPreset: detected,
  })
  return publicImport(staged)
}

async function loadImport(clinicId: string, id: string) {
  const imp = await prisma.catalogImport.findFirst({ where: { id, clinicId } })
  if (!imp) throw fail(404, 'Import not found', 'not_found')
  return imp
}

export const getImport = async (clinicId: string, id: string) =>
  publicImport(await loadImport(clinicId, id))

export async function listImports(clinicId: string) {
  const rows = await prisma.catalogImport.findMany({
    where: { clinicId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return rows.map(publicImport)
}

export const ROW_FILTERS = [
  'all',
  'create',
  'update',
  'unchanged',
  'conflict',
  'error',
  'skipped',
  'unclassified',
] as const
export type RowFilter = (typeof ROW_FILTERS)[number]

export async function listRows(
  clinicId: string,
  id: string,
  q: { page: number; pageSize: number; filter: RowFilter }
) {
  await loadImport(clinicId, id)
  const where: Prisma.CatalogImportRowWhereInput = { importId: id, clinicId }
  if (q.filter === 'skipped') where.skipped = true
  else if (q.filter === 'unclassified')
    Object.assign(where, { skipped: false, action: 'CREATE', chosenClass: null })
  else if (q.filter !== 'all')
    Object.assign(where, { skipped: false, action: q.filter.toUpperCase() })
  const [total, rows] = await Promise.all([
    prisma.catalogImportRow.count({ where }),
    prisma.catalogImportRow.findMany({
      where,
      orderBy: { position: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ])
  return {
    total,
    page: q.page,
    pageSize: q.pageSize,
    rows: rows.map((r) => ({
      id: r.id,
      position: r.position,
      externalId: r.externalId,
      name: r.name,
      nameOverride: r.nameOverride,
      sku: r.sku,
      price: r.price === null ? null : Number(r.price),
      stock: r.stock,
      imageSourceUrl: r.imageSourceUrl,
      sourceCategory: r.sourceCategory,
      suggestedClass: r.suggestedClass,
      chosenClass: r.chosenClass,
      rxLike: r.rxLike,
      skipped: r.skipped,
      action: r.action,
      matchedProductId: r.matchedProductId,
      matchedBy: r.matchedBy,
      diff: r.diff,
      error: r.error,
    })),
  }
}

export interface RowEdits {
  rows?: {
    id: string
    skipped?: boolean
    nameOverride?: string | null
    chosenClass?: ProductFulfillmentClass | null
  }[]
  /** Applies to every row (or to `rowIds`). */
  bulk?: {
    rowIds?: string[]
    acceptSuggestions?: boolean
    chosenClass?: ProductFulfillmentClass | null
    skipped?: boolean
  }
  options?: Partial<ImportOptions>
}

export async function editImport(actor: Actor, id: string, edits: RowEdits) {
  const imp = await loadImport(actor.clinicId, id)
  if (imp.status !== 'PREVIEW_READY')
    throw fail(409, 'This import can no longer be changed', 'not_editable')
  const clinicId = actor.clinicId
  await prisma.$transaction(async (tx) => {
    for (const r of edits.rows ?? []) {
      const data: Prisma.CatalogImportRowUpdateManyMutationInput = {}
      if (r.skipped !== undefined) data.skipped = r.skipped
      if (r.nameOverride !== undefined) data.nameOverride = r.nameOverride?.trim() || null
      if (r.chosenClass !== undefined) data.chosenClass = r.chosenClass
      await tx.catalogImportRow.updateMany({ where: { id: r.id, importId: id, clinicId }, data })
    }
    const b = edits.bulk
    if (b) {
      const where: Prisma.CatalogImportRowWhereInput = {
        importId: id,
        clinicId,
        ...(b.rowIds ? { id: { in: b.rowIds } } : {}),
      }
      if (b.chosenClass !== undefined)
        await tx.catalogImportRow.updateMany({ where, data: { chosenClass: b.chosenClass } })
      if (b.skipped !== undefined)
        await tx.catalogImportRow.updateMany({ where, data: { skipped: b.skipped } })
      if (b.acceptSuggestions) {
        // Only rows with a suggestion, which is never the case for Rx-like items.
        const suggested = await tx.catalogImportRow.findMany({
          where: { ...where, suggestedClass: { not: null }, rxLike: false },
          select: { id: true, suggestedClass: true },
        })
        for (const r of suggested) {
          await tx.catalogImportRow.updateMany({
            where: { id: r.id, importId: id, clinicId },
            data: { chosenClass: r.suggestedClass },
          })
        }
      }
    }
    if (edits.options) {
      await tx.catalogImport.update({
        where: { id, clinicId },
        data: { options: { ...optionsOf(imp), ...edits.options } },
      })
    }
  })
  return publicImport(await restage(await loadImport(clinicId, id)))
}

export async function applyImport(actor: Actor, id: string) {
  const imp = await loadImport(actor.clinicId, id)
  if (imp.status === 'APPLYING' || imp.status === 'DONE') return publicImport(imp)
  if (imp.status !== 'PREVIEW_READY')
    throw fail(409, 'This import is not ready to apply', 'not_ready')
  // The catalog may have changed since the preview: match again first.
  const fresh = await restage(imp)
  const updated = await prisma.catalogImport.update({
    where: { id, clinicId: actor.clinicId },
    data: {
      status: 'APPLYING',
      attempts: 0,
      lastError: null,
      summary: fresh.summary as Prisma.InputJsonValue,
    },
  })
  await enqueue({ kind: 'apply', importId: id, clinicId: actor.clinicId, userId: actor.userId })
  return publicImport(updated)
}

export async function retryImport(actor: Actor, id: string) {
  const imp = await loadImport(actor.clinicId, id)
  if (imp.status !== 'FAILED') return publicImport(imp)
  const phase =
    (imp.summary as { failedPhase?: string } | null)?.failedPhase === 'apply' ? 'apply' : 'fetch'
  if (phase === 'fetch' && !imp.storeConnectionId)
    throw fail(409, 'Upload the file again', 'reupload')
  const updated = await prisma.catalogImport.update({
    where: { id, clinicId: actor.clinicId },
    data: { status: phase === 'apply' ? 'APPLYING' : 'FETCHING', attempts: 0, lastError: null },
  })
  await enqueue({ kind: phase, importId: id, clinicId: actor.clinicId, userId: actor.userId })
  return publicImport(updated)
}
