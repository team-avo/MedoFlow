/**
 * CTO-23: the owner sets a product's stock from its catalog card. Only a
 * whole number of 0 or more is sent; other roles see the count only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), show: vi.fn() }
vi.mock('@/hooks/useAppToast', () => ({ useAppToast: () => toast }))
const productApi = vi.hoisted(() => ({ adjustStock: vi.fn() }))
vi.mock('@/lib/productApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/productApi')>()),
  ...productApi,
}))

import { StockControl } from '@/components/products/StockControl'

const renderControl = (canAdjust = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StockControl productId="p1" productName="Magnesium" quantity={0} canAdjust={canAdjust} />
    </QueryClientProvider>
  )

beforeEach(() => {
  vi.clearAllMocks()
  productApi.adjustStock.mockResolvedValue({ quantityInStock: 12 })
})

describe('StockControl', () => {
  it('the owner sets the stock to a whole number', async () => {
    renderControl()
    expect(screen.getByText('0 in stock')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for Magnesium' }))
    fireEvent.change(screen.getByLabelText('Stock for Magnesium'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(productApi.adjustStock).toHaveBeenCalledWith('p1', 12))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Stock updated: 12 in stock'))
  })

  it.each(['-1', '2.5', 'ten', ''])('refuses %j without calling the API', (value) => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for Magnesium' }))
    fireEvent.change(screen.getByLabelText('Stock for Magnesium'), { target: { value } })
    expect(screen.getByText('Enter a whole number, 0 or more')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.submit(screen.getByLabelText('Stock for Magnesium').closest('form')!)
    expect(productApi.adjustStock).not.toHaveBeenCalled()
  })

  it('shows the API error and stays open', async () => {
    productApi.adjustStock.mockRejectedValue(new Error('Product not found'))
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for Magnesium' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByLabelText('Stock for Magnesium')).toBeInTheDocument()
  })

  it('other roles see the count only', () => {
    renderControl(false)
    expect(screen.getByText('0 in stock')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Adjust stock/ })).not.toBeInTheDocument()
  })
})
