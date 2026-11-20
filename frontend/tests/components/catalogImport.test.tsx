/**
 * CTO-40: catalog import preview. Counts and warnings, Rx-like items flagged
 * with no suggestion, bulk "use the suggested classes", per-row class and
 * skip, rename for conflicts, and Import sends the apply.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const importApi = vi.hoisted(() => ({
  getImportRows: vi.fn(),
  editImport: vi.fn(),
  applyImport: vi.fn(),
  uploadImportFile: vi.fn(),
}))
vi.mock('@/lib/catalogImportApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/catalogImportApi')>()),
  ...importApi,
}))

import { ImportPreview } from '@/components/catalogImport/ImportPreview'
import type { CatalogImport, ImportRow } from '@/lib/catalogImportApi'

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  )

const imp: CatalogImport = {
  id: 'imp_1',
  source: 'SHOPIFY',
  preset: null,
  storeConnectionId: 'conn_1',
  status: 'PREVIEW_READY',
  options: { syncStock: true, syncPrice: true },
  columnMapping: null,
  summary: {
    counts: {
      total: 3,
      create: 2,
      update: 0,
      unchanged: 0,
      conflict: 1,
      error: 0,
      skipped: 0,
      unclassified: 2,
      rxLike: 1,
    },
    missingUpstream: { count: 0, names: [] },
  },
  attempts: 1,
  lastError: null,
  appliedAt: null,
  createdAt: '2026-11-18T10:00:00.000Z',
}

const row = (over: Partial<ImportRow>): ImportRow => ({
  id: 'r1',
  position: 0,
  externalId: 'x1',
  name: 'Magnesium Glycinate',
  nameOverride: null,
  sku: 'MAG-60',
  price: 22,
  stock: 10,
  imageSourceUrl: null,
  sourceCategory: 'Supplements',
  suggestedClass: 'SUPPLEMENT',
  chosenClass: null,
  rxLike: false,
  skipped: false,
  action: 'CREATE',
  matchedProductId: null,
  matchedBy: null,
  diff: null,
  error: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  importApi.getImportRows.mockResolvedValue({
    total: 3,
    page: 1,
    pageSize: 50,
    rows: [
      row({}),
      row({
        id: 'r2',
        externalId: 'x2',
        name: 'Semaglutide 2.5 mg vial',
        sku: 'SEM',
        suggestedClass: null,
        rxLike: true,
      }),
      row({
        id: 'r3',
        externalId: 'x3',
        name: 'Arnica Gel',
        sku: null,
        action: 'CONFLICT',
        error: 'Another product already has this name. Rename it or skip it',
        suggestedClass: 'OTC',
      }),
    ],
  })
  importApi.editImport.mockResolvedValue(imp)
  importApi.applyImport.mockResolvedValue({ ...imp, status: 'APPLYING' })
})

describe('ImportPreview', () => {
  it('shows counts, the Rx warning, suggestions and the conflict reason', async () => {
    wrap(<ImportPreview imp={imp} file={null} onReplaced={() => undefined} />)
    expect(screen.getByText('2 new')).toBeInTheDocument()
    expect(screen.getByText('1 need attention')).toBeInTheDocument()
    expect(screen.getByText(/look like prescription items/)).toBeInTheDocument()
    expect(await screen.findByText('Magnesium Glycinate')).toBeInTheDocument()
    expect(screen.getByText('Suggested: Supplement')).toBeInTheDocument()
    expect(screen.getByText('Looks like a prescription item')).toBeInTheDocument()
    expect(screen.getByText(/Rename it or skip it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 2 products' })).toBeEnabled()
  })

  it('"Use the suggested classes" sends one bulk edit', async () => {
    wrap(<ImportPreview imp={imp} file={null} onReplaced={() => undefined} />)
    await screen.findByText('Magnesium Glycinate')
    fireEvent.click(screen.getByRole('button', { name: 'Use the suggested classes' }))
    await waitFor(() =>
      expect(importApi.editImport).toHaveBeenCalledWith('imp_1', {
        bulk: { acceptSuggestions: true },
      })
    )
  })

  it('skip and rename edit one row', async () => {
    wrap(<ImportPreview imp={imp} file={null} onReplaced={() => undefined} />)
    await screen.findByText('Arnica Gel')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Skip Semaglutide 2.5 mg vial' }))
    await waitFor(() =>
      expect(importApi.editImport).toHaveBeenCalledWith('imp_1', {
        rows: [{ id: 'r2', skipped: true }],
      })
    )
    fireEvent.change(screen.getByLabelText('New name for Arnica Gel'), {
      target: { value: 'Arnica Gel (clinic size)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() =>
      expect(importApi.editImport).toHaveBeenCalledWith('imp_1', {
        rows: [{ id: 'r3', nameOverride: 'Arnica Gel (clinic size)' }],
      })
    )
  })

  it('Import applies the import', async () => {
    wrap(<ImportPreview imp={imp} file={null} onReplaced={() => undefined} />)
    await screen.findByText('Magnesium Glycinate')
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 products' }))
    await waitFor(() => expect(importApi.applyImport).toHaveBeenCalledWith('imp_1'))
  })

  it('nothing to import disables the button', () => {
    const empty = { ...imp, summary: { counts: { ...imp.summary.counts!, create: 0, update: 0 } } }
    wrap(<ImportPreview imp={empty} file={null} onReplaced={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Nothing to import' })).toBeDisabled()
  })
})
