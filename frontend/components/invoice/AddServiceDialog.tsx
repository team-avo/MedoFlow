'use client'

import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { addInvoiceItem, type InvoiceItem } from '@/lib/invoiceApi'
import { getDashboardServices } from '@/lib/serviceApi'
import { useAppToast } from '@/hooks/useAppToast'

interface AddServiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  onSuccess: (item: InvoiceItem) => void
}

export function AddServiceDialog({
  open,
  onOpenChange,
  invoiceId,
  onSuccess,
}: AddServiceDialogProps) {
  const toast = useAppToast()
  const [serviceId, setServiceId] = useState<string>('')
  const [description, setDescription] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: services = [], isLoading: servicesLoading } = useQuery({
    queryKey: ['dashboard-services'],
    queryFn: () => getDashboardServices(),
    enabled: open,
  })

  const selectedService = services.find((s) => s.id === serviceId)

  useEffect(() => {
    if (selectedService) {
      setDescription(selectedService.name)
      setUnitPrice(selectedService.defaultPrice)
    }
  }, [selectedService])

  const reset = () => {
    setServiceId('')
    setDescription('')
    setUnitPrice('')
    setQuantity(1)
  }

  const handleClose = (open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serviceId || !description || !unitPrice) {
      toast.error('Service, description, and price are required')
      return
    }
    const price = parseFloat(unitPrice)
    if (Number.isNaN(price) || price < 0) {
      toast.error('Invalid price')
      return
    }
    setIsSubmitting(true)
    try {
      const item = await addInvoiceItem(invoiceId, {
        serviceId,
        description,
        unitPrice: price,
        quantity,
      })
      toast.success('Service added to invoice')
      onSuccess(item)
      handleClose(false)
    } catch {
      toast.error('Failed to add service')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Service</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Service</label>
            <Select value={serviceId} onValueChange={setServiceId} disabled={servicesLoading}>
              <SelectTrigger>
                <SelectValue
                  placeholder={servicesLoading ? 'Loading services…' : 'Select service'}
                />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} - ${s.defaultPrice}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Unit Price</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0.00"
              />
              {selectedService &&
                unitPrice !== '' &&
                parseFloat(unitPrice) !== parseFloat(selectedService.defaultPrice) && (
                  <Badge variant="destructive" className="shrink-0 text-xs">
                    Overridden
                  </Badge>
                )}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Quantity</label>
            <Input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
