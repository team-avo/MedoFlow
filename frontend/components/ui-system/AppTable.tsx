'use client'

/**
 * AppTable — tabular data with optional mobile card rendering.
 *
 * Two modes:
 *  • Default (`mobileCardMode` omitted) — renders a <table> with horizontal
 *    scroll on narrow viewports. Matches every current caller's expectation,
 *    so this is 100% backward-compatible.
 *  • `mobileCardMode` — on <md screens, rows render as stacked cards with
 *    label/value pairs. Optionally mark one column as `mobilePrimary` to
 *    show it as the card's title. Use this for data-dense admin tables
 *    (audit, invoices, patients, commissions) so they stay legible on phones.
 */

import * as React from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AppEmptyState } from './AppEmptyState'
import { cn } from '@/lib/utils'

export interface AppTableColumn<T> {
  key: string
  header: string
  render: (item: T) => React.ReactNode
  className?: string
  /** Shorter label for mobile card rows (defaults to `header`). */
  mobileLabel?: string
  /** Mark one column as the card "title" on mobile. Only the first wins. */
  mobilePrimary?: boolean
  /** Hide this column entirely in mobile card mode. */
  mobileHidden?: boolean
  /**
   * Let this column's text wrap (notes, descriptions). Off by default: cells
   * stay on one line and the table scrolls sideways instead of squeezing
   * names, dates and badges onto two lines.
   */
  wrap?: boolean
}

export interface AppTableProps<T> {
  columns: AppTableColumn<T>[]
  data: T[]
  keyExtractor: (item: T) => string
  emptyTitle?: string
  emptyDescription?: string
  emptyActionLabel?: string
  onEmptyAction?: () => void
  className?: string
  /** Opt into stacked cards on <md viewports. Off by default. */
  mobileCardMode?: boolean
  /** Row click (both modes). Makes the row/card interactive + keyboard-accessible. */
  onRowClick?: (item: T) => void
}

export function AppTable<T>({
  columns,
  data,
  keyExtractor,
  emptyTitle = 'No data yet',
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  className,
  mobileCardMode = false,
  onRowClick,
}: AppTableProps<T>) {
  const showEmpty = data.length === 0
  const tableShell = (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-2xl border border-slate-100',
        mobileCardMode && 'hidden md:block',
        className
      )}
    >
      <Table className="min-w-max">
        <TableHeader>
          <TableRow className="border-b border-slate-100 hover:bg-transparent">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  'h-12 whitespace-nowrap px-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground',
                  col.className
                )}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {showEmpty ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-48 p-0 align-top">
                <AppEmptyState
                  title={emptyTitle}
                  description={emptyDescription}
                  actionLabel={emptyActionLabel}
                  onAction={onEmptyAction}
                />
              </TableCell>
            </TableRow>
          ) : (
            data.map((item) => (
              <TableRow
                key={keyExtractor(item)}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                className={cn(
                  'border-b border-slate-100 text-sm transition-colors hover:bg-subtle',
                  onRowClick && 'cursor-pointer'
                )}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-sm text-foreground',
                      col.wrap ? 'min-w-[12rem] max-w-md whitespace-normal' : 'whitespace-nowrap',
                      col.className
                    )}
                  >
                    {col.render(item)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )

  if (!mobileCardMode) return tableShell

  // Mobile card list (rendered alongside; sibling .hidden md:block above
  // ensures only one is visible at a time).
  const primaryKey = columns.find((c) => c.mobilePrimary)?.key
  const visibleCols = columns.filter((c) => !c.mobileHidden)

  return (
    <>
      {tableShell}
      <div className={cn('space-y-3 md:hidden', className)}>
        {showEmpty ? (
          <div className="rounded-2xl border border-slate-100 bg-white">
            <AppEmptyState
              title={emptyTitle}
              description={emptyDescription}
              actionLabel={emptyActionLabel}
              onAction={onEmptyAction}
            />
          </div>
        ) : (
          data.map((item) => {
            const primary = primaryKey ? columns.find((c) => c.key === primaryKey) : null
            const rest = visibleCols.filter((c) => c.key !== primaryKey)
            const interactive = Boolean(onRowClick)

            const cardContent = (
              <>
                {primary && (
                  <div className="mb-3 text-[15px] font-medium text-foreground">
                    {primary.render(item)}
                  </div>
                )}
                <dl className="space-y-2">
                  {rest.map((col) => (
                    <div
                      key={col.key}
                      className="flex items-start justify-between gap-3 text-[13px]"
                    >
                      <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {col.mobileLabel ?? col.header}
                      </dt>
                      <dd className="min-w-0 flex-1 text-right text-foreground">
                        {col.render(item)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )

            const base = 'rounded-2xl border border-slate-100 bg-white p-4 transition-colors'

            return interactive ? (
              <button
                key={keyExtractor(item)}
                type="button"
                onClick={() => onRowClick!(item)}
                className={cn(base, 'w-full text-left hover:border-slate-200 active:bg-subtle')}
              >
                {cardContent}
              </button>
            ) : (
              <div key={keyExtractor(item)} className={base}>
                {cardContent}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
