/**
 * Component 5 — Prescription → Cart UI.
 *  F5.1 detected-product chips: removable, unmapped items surfaced, nothing
 *       is sent without the provider's confirmation
 *  F5.2 cart provenance "Prescribed · Dr. X" + accept / decline; one-click pay
 *  F5.3 card + address "on file from booking", no card / address fields
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rxApi = vi.hoisted(() => ({
  getProposal: vi.fn(),
  getCatalog: vi.fn(),
  updateProposalLines: vi.fn(),
  getOnFile: vi.fn(),
  oneClickCheckout: vi.fn(),
}))
vi.mock('@/lib/rxCartApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rxCartApi')>()),
  ...rxApi,
}))

import {
  DetectedProductsPanel,
  rxApproval,
  type RxSelection,
} from '@/components/rxCart/DetectedProductsPanel'
import { OneClickPay } from '@/components/store/OneClickPay'
import { PrescribedBadge, DecisionButtons } from '@/components/store/CartModal'
import type { CartItem } from '@/hooks/useCart'

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  )

const product = (id: string, name: string, fulfillmentClass = 'SUPPLEMENT') => ({
  id,
  name,
  sku: null,
  price: '20.00',
  fulfillmentClass,
})

const proposal = {
  id: 'prop_1',
  status: 'PENDING',
  lines: [
    {
      id: 'l_mag',
      rawText: 'Magnesium glycinate 400 mg',
      quantity: 2,
      matchedProductId: 'p_mag',
      matchStatus: 'MATCHED',
      route: 'CART',
      decision: 'PENDING',
      matchedProduct: product('p_mag', 'Magnesium Glycinate'),
    },
    {
      id: 'l_arnica',
      rawText: 'Arnica gel',
      quantity: 1,
      matchedProductId: 'p_arn',
      matchStatus: 'MATCHED',
      route: 'CART',
      decision: 'PENDING',
      matchedProduct: product('p_arn', 'Arnica Gel', 'OTC'),
    },
    {
      id: 'l_tram',
      rawText: 'Tramadol 50 mg',
      quantity: 1,
      matchedProductId: 'p_tram',
      matchStatus: 'MATCHED',
      route: 'EPRESCRIBE',
      decision: 'PENDING',
      matchedProduct: product('p_tram', 'Tramadol', 'RX_SCHEDULED'),
    },
    {
      id: 'l_turmeric',
      rawText: 'Turmeric complex',
      quantity: 1,
      matchedProductId: null,
      matchStatus: 'UNMAPPED',
      route: 'MANUAL',
      decision: 'PENDING',
      matchedProduct: null,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  rxApi.getProposal.mockResolvedValue(proposal)
  rxApi.getCatalog.mockResolvedValue([product('p_turm', 'Turmeric Curcumin')])
})

function renderPanel() {
  const selections: (RxSelection | null)[] = []
  const onSelectionChange = vi.fn((s: RxSelection | null) => selections.push(s))
  wrap(<DetectedProductsPanel sessionId="s1" onSelectionChange={onSelectionChange} />)
  return { selections, last: () => selections[selections.length - 1] ?? null }
}

describe('F5.1 DetectedProductsPanel', () => {
  it('shows matched products as chips with their route, and the unmapped one separately', async () => {
    renderPanel()
    expect(await screen.findByText('Magnesium Glycinate × 2')).toBeInTheDocument()
    expect(screen.getByText('Arnica Gel × 1')).toBeInTheDocument()
    expect(screen.getByText('Tramadol × 1')).toBeInTheDocument()
    expect(screen.getAllByText('Cart')).toHaveLength(2)
    expect(screen.getByText('e-Prescribe')).toBeInTheDocument()
    // Unmapped is never hidden: it is listed with a "map to product" control.
    expect(screen.getByText('Turmeric complex × 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Map Turmeric complex to a product')).toBeInTheDocument()
  })

  it('cannot be sent until the provider confirms', async () => {
    const { last } = renderPanel()
    await screen.findByText('Magnesium Glycinate × 2')
    await waitFor(() => expect(last()).not.toBeNull())
    expect(last()!.acknowledged).toBe(false)
    expect(rxApproval(last())).toEqual({
      ok: false,
      reason: 'Confirm the detected products before sending',
    })

    fireEvent.click(screen.getByLabelText('I confirm these products for this patient'))
    await waitFor(() => expect(last()!.acknowledged).toBe(true))
    expect(rxApproval(last())).toEqual({
      ok: true,
      rxConfirmation: {
        proposalId: 'prop_1',
        confirmedLineIds: ['l_mag', 'l_arnica', 'l_tram'],
        acknowledged: true,
      },
    })
  })

  it('a removed chip is not sent, and removing resets the confirmation', async () => {
    const { last } = renderPanel()
    await screen.findByText('Magnesium Glycinate × 2')
    fireEvent.click(screen.getByLabelText('I confirm these products for this patient'))
    await waitFor(() => expect(last()!.acknowledged).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Remove Arnica Gel' }))
    await waitFor(() => expect(last()!.confirmedLineIds).toEqual(['l_mag', 'l_tram']))
    expect(last()!.acknowledged).toBe(false)
    expect(screen.getByRole('button', { name: 'Restore Arnica Gel' })).toBeInTheDocument()
    expect(screen.getByTestId('rx-send-summary')).toHaveTextContent(
      "1 to the patient's cart, 1 to e-prescribe"
    )
  })

  it('maps an unmapped item to a catalog product', async () => {
    rxApi.updateProposalLines.mockResolvedValue(proposal)
    renderPanel()
    const select = await screen.findByLabelText('Map Turmeric complex to a product')
    await screen.findByRole('option', { name: /Turmeric Curcumin/ })
    fireEvent.change(select, { target: { value: 'p_turm' } })
    await waitFor(() =>
      expect(rxApi.updateProposalLines).toHaveBeenCalledWith('prop_1', {
        lines: [{ id: 'l_turmeric', productId: 'p_turm' }],
      })
    )
  })

  it('renders nothing and reports no selection when nothing was detected', async () => {
    rxApi.getProposal.mockResolvedValue(null)
    const { last } = renderPanel()
    await waitFor(() => expect(rxApi.getProposal).toHaveBeenCalled())
    expect(screen.queryByLabelText('Detected products')).not.toBeInTheDocument()
    expect(last()).toBeNull()
    expect(rxApproval(null)).toEqual({ ok: true })
  })
})

const prescribedItem = (over: Partial<CartItem> = {}): CartItem => ({
  id: 'ci_1',
  itemId: 'p_mag',
  itemType: 'PRODUCT',
  name: 'Magnesium Glycinate',
  unitPrice: 20,
  quantity: 2,
  rxOrderLineId: 'l_mag',
  prescribedBy: { id: 'prov_1', firstName: 'Avery', lastName: 'Stone' },
  patientDecision: 'PENDING',
  ...over,
})

describe('F5.2 cart provenance and accept / decline', () => {
  it('shows "Prescribed · Dr. X" only on prescribed items', () => {
    const { rerender } = render(<PrescribedBadge item={prescribedItem()} />)
    expect(screen.getByText('Prescribed · Dr. Avery Stone')).toBeInTheDocument()
    rerender(<PrescribedBadge item={prescribedItem({ rxOrderLineId: null, prescribedBy: null })} />)
    expect(screen.queryByText(/Prescribed/)).not.toBeInTheDocument()
  })

  it('accept and decline report the decision', () => {
    const onDecide = vi.fn()
    render(<DecisionButtons item={prescribedItem()} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept Magnesium Glycinate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Decline Magnesium Glycinate' }))
    expect(onDecide.mock.calls).toEqual([['ACCEPTED'], ['DECLINED']])
  })

  it('a declined item says it is not charged and can be accepted again', () => {
    const onDecide = vi.fn()
    render(
      <DecisionButtons item={prescribedItem({ patientDecision: 'DECLINED' })} onDecide={onDecide} />
    )
    expect(screen.getByText('Declined — not charged')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept instead' }))
    expect(onDecide).toHaveBeenCalledWith('ACCEPTED')
  })
})

const onFile = {
  eligible: true,
  reason: null,
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
  shippingAddress: {
    name: 'Synthetic Patient',
    line1: '100 Example Street',
    line2: null,
    city: 'Testville',
    state: 'CA',
    postalCode: '90000',
    country: 'US',
  },
}

describe('F5.2 / F5.3 OneClickPay', () => {
  it('shows card and address on file from booking, with no entry fields', async () => {
    rxApi.getOnFile.mockResolvedValue(onFile)
    wrap(<OneClickPay total={40} pendingDecisions={0} onPaid={vi.fn()} />)
    expect(await screen.findByText('Visa •••• 4242')).toBeInTheDocument()
    expect(screen.getByText(/100 Example Street/)).toBeInTheDocument()
    expect(screen.getAllByText('On file from booking')).toHaveLength(2)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('pays in one action', async () => {
    rxApi.getOnFile.mockResolvedValue(onFile)
    const result = { status: 'succeeded', invoiceId: 'inv_1', paymentIntentId: 'pi_1' }
    rxApi.oneClickCheckout.mockResolvedValue(result)
    const onPaid = vi.fn()
    wrap(<OneClickPay total={40} pendingDecisions={0} onPaid={onPaid} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $40.00 with card on file' }))
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(result))
    expect(rxApi.oneClickCheckout).toHaveBeenCalledTimes(1)
  })

  it('a decline is a recoverable error, not a crash', async () => {
    rxApi.getOnFile.mockResolvedValue(onFile)
    rxApi.oneClickCheckout.mockRejectedValue({
      response: {
        status: 402,
        data: {
          code: 'CARD_DECLINED',
          message: 'Your card was declined. Try again or use a different card.',
        },
      },
    })
    const onPaid = vi.fn()
    wrap(<OneClickPay total={40} pendingDecisions={0} onPaid={onPaid} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $40.00 with card on file' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined')
    expect(onPaid).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pay $40.00 with card on file' })).toBeEnabled()
  })

  it('waits for accept / decline on prescribed items', async () => {
    rxApi.getOnFile.mockResolvedValue(onFile)
    wrap(<OneClickPay total={40} pendingDecisions={1} onPaid={vi.fn()} />)
    expect(
      await screen.findByRole('button', { name: 'Pay $40.00 with card on file' })
    ).toBeDisabled()
    expect(
      screen.getByText(/Accept or decline the items your provider prescribed/)
    ).toBeInTheDocument()
  })

  it('without a card on file it renders the regular checkout instead', async () => {
    rxApi.getOnFile.mockResolvedValue({
      ...onFile,
      eligible: false,
      reason: 'NO_CARD_ON_FILE',
      card: null,
    })
    wrap(
      <OneClickPay
        total={40}
        pendingDecisions={0}
        onPaid={vi.fn()}
        fallback={<button type="button">Secure Checkout</button>}
      />
    )
    expect(await screen.findByRole('button', { name: 'Secure Checkout' })).toBeInTheDocument()
    expect(screen.queryByText(/with card on file/)).not.toBeInTheDocument()
  })
})
