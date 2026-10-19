/**
 * B5.2 clinician-confirm gating, at the service boundary: the cart builder
 * refuses any proposal a provider has not explicitly confirmed, whoever
 * calls it. A fake transaction client records every write.
 */
import assert from 'node:assert/strict'
import * as rxCartService from '../services/rxCartService'
import type { TxClient } from '../config/prisma'

const line = (over: Record<string, unknown> = {}) => ({
  id: 'line_1',
  route: 'CART',
  quantity: 2,
  matchedProductId: 'prod_1',
  matchedProduct: { id: 'prod_1', price: 10, isActive: true, name: 'Synthetic product' },
  cartItem: null,
  prescription: null,
  ...over,
})

function fakeTx(proposal: Record<string, unknown> | null) {
  const writes: string[] = []
  const tx = {
    rxOrderProposal: {
      findFirst: async () => proposal,
      update: async () => {
        writes.push('proposal.update')
        return proposal
      },
    },
    rxOrderLine: {
      update: async ({ data }: { data: { decision: string } }) => {
        writes.push(`line.${data.decision}`)
        return {}
      },
    },
    cart: {
      findFirst: async () => null,
      create: async () => {
        writes.push('cart.create')
        return { id: 'cart_1' }
      },
    },
    cartItem: {
      create: async () => {
        writes.push('cartItem.create')
        return { id: `item_${writes.length}` }
      },
    },
    prescription: {
      create: async () => {
        writes.push('prescription.create')
        return { id: 'rx_1' }
      },
    },
  }
  return { tx: tx as unknown as TxClient, writes }
}

const base = {
  id: 'prop_1',
  clinicId: 'clinic_1',
  patientId: 'patient_1',
  providerId: 'provider_1',
  appointmentId: 'appt_1',
  cartId: null,
}

describe('buildCartFromProposal (B5.2 / B5.3)', () => {
  it('refuses a PENDING proposal: no cart, no items', async () => {
    const { tx, writes } = fakeTx({ ...base, status: 'PENDING', lines: [line()] })
    await assert.rejects(rxCartService.buildCartFromProposal(tx, 'prop_1', 'clinic_1'), {
      code: 'RX_NOT_CONFIRMED',
      statusCode: 409,
    })
    assert.deepEqual(writes, [])
  })

  it('refuses a proposal marked CONFIRMED without a recorded confirmer', async () => {
    const { tx, writes } = fakeTx({
      ...base,
      status: 'CONFIRMED',
      confirmedById: null,
      confirmedAt: null,
      lines: [line()],
    })
    await assert.rejects(rxCartService.buildCartFromProposal(tx, 'prop_1', 'clinic_1'), {
      code: 'RX_NOT_CONFIRMED',
    })
    assert.deepEqual(writes, [])
  })

  it('builds cart items for CART lines and prescriptions for EPRESCRIBE lines', async () => {
    const { tx, writes } = fakeTx({
      ...base,
      status: 'CONFIRMED',
      confirmedById: 'user_provider',
      confirmedAt: new Date(),
      lines: [line(), line({ id: 'line_2', route: 'EPRESCRIBE' })],
    })
    const built = await rxCartService.buildCartFromProposal(tx, 'prop_1', 'clinic_1')
    assert.equal(built.cartId, 'cart_1')
    assert.equal(built.cartItemIds.length, 1)
    assert.equal(built.prescriptionIds.length, 1)
    assert.deepEqual(writes, [
      'cart.create',
      'cartItem.create',
      'prescription.create',
      'proposal.update',
    ])
  })

  it('is idempotent: lines that already produced an item are not added twice', async () => {
    const { tx, writes } = fakeTx({
      ...base,
      cartId: 'cart_1',
      status: 'CONFIRMED',
      confirmedById: 'user_provider',
      confirmedAt: new Date(),
      lines: [line({ cartItem: { id: 'item_existing' } })],
    })
    const built = await rxCartService.buildCartFromProposal(tx, 'prop_1', 'clinic_1')
    assert.deepEqual(built.cartItemIds, ['item_existing'])
    assert.ok(!writes.includes('cartItem.create'))
  })
})

describe('confirmProposal (B5.2)', () => {
  const pending = {
    ...base,
    status: 'PENDING',
    lines: [
      { id: 'l_cart', route: 'CART', matchedProductId: 'p1' },
      { id: 'l_manual', route: 'MANUAL', matchedProductId: null },
    ],
  }

  it('requires the explicit acknowledgement', async () => {
    const { tx, writes } = fakeTx(pending)
    await assert.rejects(
      rxCartService.confirmProposal(tx, 'prop_1', 'provider_1', 'clinic_1', 'u', {
        confirmedLineIds: ['l_cart'],
        acknowledged: false as unknown as true,
      }),
      { code: 'confirmation_required' }
    )
    assert.deepEqual(writes, [])
  })

  it('confirms the named lines and removes the rest', async () => {
    const { tx, writes } = fakeTx(pending)
    const counts = await rxCartService.confirmProposal(
      tx,
      'prop_1',
      'provider_1',
      'clinic_1',
      'u',
      {
        confirmedLineIds: ['l_cart'],
        acknowledged: true,
      }
    )
    assert.deepEqual(counts, { confirmed: 1, removed: 1 })
    assert.deepEqual(writes, ['line.CONFIRMED', 'line.REMOVED', 'proposal.update'])
  })

  it('will not confirm an item that is not mapped to a product', async () => {
    const { tx } = fakeTx(pending)
    await assert.rejects(
      rxCartService.confirmProposal(tx, 'prop_1', 'provider_1', 'clinic_1', 'u', {
        confirmedLineIds: ['l_manual'],
        acknowledged: true,
      }),
      { code: 'line_unmapped', statusCode: 422 }
    )
  })

  it("another provider's proposal is not found", async () => {
    const { tx } = fakeTx(null)
    await assert.rejects(
      rxCartService.confirmProposal(tx, 'prop_1', 'provider_2', 'clinic_1', 'u', {
        confirmedLineIds: [],
        acknowledged: true,
      }),
      { statusCode: 404 }
    )
  })
})
