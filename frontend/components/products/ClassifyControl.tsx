'use client'

/**
 * CTO-40: an imported product arrives "Needs classification" and is not sold
 * anywhere (cart, storefront, Rx to cart) until someone picks its class.
 * Owners can classify it here, straight from the Storefront card.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AppSelect } from '@/components/ui-system'
import { useAppToast } from '@/hooks/useAppToast'
import { updateProduct } from '@/lib/productApi'
import { FULFILLMENT_CLASS_LABELS, type FulfillmentClass } from '@/lib/rxCartApi'

const OPTIONS = (Object.keys(FULFILLMENT_CLASS_LABELS) as FulfillmentClass[]).map((c) => ({
  value: c,
  label: FULFILLMENT_CLASS_LABELS[c],
}))

export function ClassifyControl({
  productId,
  productName,
  canEdit,
}: {
  productId: string
  productName: string
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useAppToast()
  const mutation = useMutation({
    mutationFn: (fulfillmentClass: FulfillmentClass) =>
      updateProduct(productId, { fulfillmentClass }),
    onSuccess: () => {
      toast.success(`${productName} can now be sold`)
      void queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: () => toast.error('The class could not be saved. Please try again.'),
  })

  return (
    <div
      className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
      data-testid="needs-classification"
    >
      <p className="text-xs font-semibold text-amber-900">Needs classification</p>
      <p className="text-[11px] text-amber-800">
        Not for sale until you choose what kind of product this is.
      </p>
      {canEdit && (
        <>
          <label htmlFor={`classify-${productId}`} className="sr-only">
            {`Class for ${productName}`}
          </label>
          <AppSelect
            id={`classify-${productId}`}
            className="mt-2 h-8 bg-white text-xs"
            placeholder="Choose a class"
            options={OPTIONS}
            disabled={mutation.isPending}
            onValueChange={(v) => mutation.mutate(v as FulfillmentClass)}
          />
        </>
      )}
    </div>
  )
}
