/**
 * "Key changes to approve" on the AI scribe draft (CTO-33).
 *
 * Compares this visit's detected orders with what was approved for the same
 * patient at earlier visits (their confirmed Rx order lines) and lists:
 *   - START:        a medication (e-prescribe or unmapped) not ordered before
 *   - NEW_PRODUCT:  a store product not ordered before
 *   - DOSE_CHANGE:  the same item at a different dose ("from" → "to")
 *   - STOP:         an order that says to stop or discontinue something
 * Each change is linked to its order line, so approving or rejecting it is
 * approving or rejecting that line. Deterministic; no model call.
 *
 * Also reports each line's stock: in stock, not stocked (inactive or zero
 * on hand), unmapped (nothing in the catalog: an alternative or external
 * item), or e-prescribe. The raw order text and dose are PHI: they are shown
 * to the treating provider only, never audited or logged.
 */
import prisma from '../config/prisma'

export type KeyChangeKind = 'START' | 'STOP' | 'DOSE_CHANGE' | 'NEW_PRODUCT'
export type StockState = 'IN_STOCK' | 'NOT_STOCKED' | 'UNMAPPED' | 'EPRESCRIBE'

export interface KeyChange {
  lineId: string
  kind: KeyChangeKind
  label: string
  from: string | null
  to: string | null
  stock: StockState
}

const STOP_RE = /\b(stop|stopping|discontinue|discontinued|cease|quit)\b/i

export const normalizeDose = (d: string | null | undefined) =>
  (d ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/milligrams?/g, 'mg')

/** What makes two orders "the same item": the product, or the spoken name. */
export function itemKey(line: {
  matchedProductId: string | null
  rawText: string
  dose: string | null
}) {
  if (line.matchedProductId) return `p:${line.matchedProductId}`
  let name = line.rawText.toLowerCase()
  if (line.dose) name = name.replace(line.dose.toLowerCase(), '')
  name = name
    .replace(STOP_RE, '')
    .replace(/\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|units?)\b/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `t:${name}`
}

export function stockOf(line: {
  route: string
  matchedProduct: {
    isActive: boolean
    inventoryItem: { quantityInStock: number } | null
  } | null
}): StockState {
  if (!line.matchedProduct || line.route === 'MANUAL') return 'UNMAPPED'
  if (line.route === 'EPRESCRIBE') return 'EPRESCRIBE'
  const inv = line.matchedProduct.inventoryItem
  // No inventory record = not tracked, so available.
  if (!line.matchedProduct.isActive || (inv && inv.quantityInStock <= 0)) return 'NOT_STOCKED'
  return 'IN_STOCK'
}

type Line = {
  id: string
  rawText: string
  dose: string | null
  route: string
  matchedProductId: string | null
  matchedProduct: {
    name: string
    isActive: boolean
    inventoryItem: { quantityInStock: number } | null
  } | null
}

/** Pure: the key changes for `current`, given earlier approved lines. */
export function computeKeyChanges(
  current: Line[],
  prior: Array<Pick<Line, 'rawText' | 'dose' | 'matchedProductId'>>
): KeyChange[] {
  const before = new Map<string, { dose: string | null }>()
  for (const p of prior) {
    const k = itemKey(p)
    if (!before.has(k)) before.set(k, { dose: p.dose })
  }
  const changes: KeyChange[] = []
  for (const line of current) {
    const label = line.matchedProduct?.name ?? line.rawText
    const stock = stockOf(line)
    if (STOP_RE.test(line.rawText)) {
      changes.push({ lineId: line.id, kind: 'STOP', label, from: line.dose, to: null, stock })
      continue
    }
    const prev = before.get(itemKey(line))
    if (!prev) {
      changes.push({
        lineId: line.id,
        kind: line.route === 'CART' ? 'NEW_PRODUCT' : 'START',
        label,
        from: null,
        to: line.dose,
        stock,
      })
    } else if (line.dose && normalizeDose(prev.dose) !== normalizeDose(line.dose)) {
      changes.push({
        lineId: line.id,
        kind: 'DOSE_CHANGE',
        label,
        from: prev.dose,
        to: line.dose,
        stock,
      })
    }
  }
  return changes
}

const lineSelect = {
  id: true,
  rawText: true,
  dose: true,
  route: true,
  matchedProductId: true,
  matchedProduct: {
    select: { name: true, isActive: true, inventoryItem: { select: { quantityInStock: true } } },
  },
} as const

/** The key changes for one scribe session (its own provider only). */
export async function keyChangesForSession(
  sessionId: string,
  providerId: string,
  clinicId: string
) {
  const proposal = await prisma.rxOrderProposal.findFirst({
    where: { aiScribeSessionId: sessionId, providerId, clinicId },
    select: {
      id: true,
      patientId: true,
      createdAt: true,
      lines: { select: lineSelect, orderBy: { position: 'asc' } },
    },
  })
  if (!proposal) return { proposalId: null, changes: [] as KeyChange[] }
  const priorLines = await prisma.rxOrderLine.findMany({
    where: {
      clinicId,
      decision: 'CONFIRMED',
      proposal: {
        patientId: proposal.patientId,
        status: 'CONFIRMED',
        id: { not: proposal.id },
        createdAt: { lt: proposal.createdAt },
      },
    },
    select: { rawText: true, dose: true, matchedProductId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return { proposalId: proposal.id, changes: computeKeyChanges(proposal.lines, priorLines) }
}
