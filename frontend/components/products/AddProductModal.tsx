'use client'

import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AppModal, AppFormField, AppInput, AppButton } from '@/components/ui-system'
import { createProduct, type CreateProductPayload } from '@/lib/productApi'
import { FULFILLMENT_CLASS_LABELS, type FulfillmentClass } from '@/lib/rxCartApi'
import { useAppToast } from '@/hooks/useAppToast'

const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  description: z.string().optional(),
  sku: z.string().optional(),
  price: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: 'Price must be a positive number',
  }),
  fulfillmentClass: z.enum(['SUPPLEMENT', 'OTC', 'AESTHETIC', 'RX_NON_SCHEDULED', 'RX_SCHEDULED']),
  aliases: z.string().max(1000).optional(),
})

type ProductFormData = z.infer<typeof productSchema>

interface AddProductModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddProductModal({ open, onOpenChange }: AddProductModalProps) {
  const queryClient = useQueryClient()
  const toast = useAppToast()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      description: '',
      sku: '',
      price: '',
      fulfillmentClass: 'SUPPLEMENT',
      aliases: '',
    },
  })

  const mutation = useMutation({
    mutationFn: (values: ProductFormData) => {
      const payload: CreateProductPayload = {
        name: values.name,
        description: values.description,
        sku: values.sku,
        price: Number(values.price),
        fulfillmentClass: values.fulfillmentClass as FulfillmentClass,
        aliases: (values.aliases ?? '')
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
      }
      return createProduct(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Product added successfully')
      onOpenChange(false)
      reset()
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || 'Failed to add product')
    },
  })

  const onSubmit = (data: ProductFormData) => {
    mutation.mutate(data)
  }

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add New Product"
      description="Enter the details of the new product to add it to the catalog."
      primaryAction={{
        label: mutation.isPending ? 'Adding...' : 'Add Product',
        onClick: handleSubmit(onSubmit),
        disabled: mutation.isPending,
      }}
      content={
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <AppFormField label="Product Name" error={errors.name?.message}>
            <AppInput {...register('name')} placeholder="e.g. Daily Wellness Pack" />
          </AppFormField>

          <AppFormField label="SKU (Optional)" error={errors.sku?.message}>
            <AppInput {...register('sku')} placeholder="e.g. WELL-001" />
          </AppFormField>

          <AppFormField label="Price ($)" error={errors.price?.message}>
            <AppInput {...register('price')} type="text" placeholder="0.00" />
          </AppFormField>

          <AppFormField label="Classification" error={errors.fulfillmentClass?.message}>
            <select
              {...register('fulfillmentClass')}
              aria-label="Classification"
              className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
            >
              {(Object.keys(FULFILLMENT_CLASS_LABELS) as FulfillmentClass[]).map((c) => (
                <option key={c} value={c}>
                  {FULFILLMENT_CLASS_LABELS[c]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Prescription products are routed to e-prescribing and never sold from the cart or
              storefront.
            </p>
          </AppFormField>

          <AppFormField
            label="Also known as (comma separated, optional)"
            error={errors.aliases?.message}
          >
            <AppInput
              {...register('aliases')}
              placeholder="e.g. mag glycinate, magnesium bisglycinate"
            />
          </AppFormField>

          <AppFormField label="Description" error={errors.description?.message}>
            <textarea
              {...register('description')}
              className="flex min-h-[80px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Describe the product benefits..."
            />
          </AppFormField>
        </form>
      }
    />
  )
}
