'use client'

/**
 * A product's stock on its catalog card (CTO-23): the count, and for the
 * clinic owner an "Adjust stock" editor that sets it.
 */
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AppButton, AppInput } from '@/components/ui-system'
import { useAppToast } from '@/hooks/useAppToast'
import { apiErrorOf } from '@/lib/apiError'
import { adjustStock } from '@/lib/productApi'
import { cn } from '@/lib/utils'

const MAX_STOCK = 1_000_000

export function StockControl({
  productId,
  productName,
  quantity,
  canAdjust,
}: {
  productId: string
  productName: string
  quantity: number
  canAdjust: boolean
}) {
  const toast = useAppToast()
  const qc = useQueryClient()
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(String(quantity))
  const parsed = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_STOCK

  const save = useMutation({
    mutationFn: () => adjustStock(productId, parsed),
    onSuccess: () => {
      toast.success(`Stock updated: ${parsed} in stock`)
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (err) => toast.error(apiErrorOf(err).message),
  })

  if (editing) {
    const id = `stock-${productId}`
    return (
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) save.mutate()
        }}
      >
        <div>
          <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
            Stock for {productName}
          </label>
          <AppInput
            id={id}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            aria-invalid={!valid}
            className="h-9 w-24"
            autoFocus
          />
          {!valid && <p className="mt-1 text-xs text-rose-600">Enter a whole number, 0 or more</p>}
        </div>
        <AppButton type="submit" size="sm" disabled={!valid || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </AppButton>
        <AppButton type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </AppButton>
      </form>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={cn(
          'rounded-lg px-2.5 py-1 text-xs font-bold',
          quantity > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        )}
      >
        {quantity} in stock
      </span>
      {canAdjust && (
        <button
          type="button"
          className="text-xs font-semibold text-brand hover:underline"
          aria-label={`Adjust stock for ${productName}`}
          onClick={() => {
            setValue(String(quantity))
            setEditing(true)
          }}
        >
          Adjust stock
        </button>
      )}
    </div>
  )
}
