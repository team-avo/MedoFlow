'use client'

/**
 * Staff: cancel every upcoming visit of a recurring series in one action
 * (F1.2). Past and completed visits are kept; each cancelled visit follows
 * the normal cancellation path on the server (notifications, waitlist).
 */
import React, { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cancelRecurringSeries } from '@/lib/recurringApi'
import { bookingErrorMessage } from '@/lib/bookingErrors'
import { useAppToast } from '@/hooks/useAppToast'

interface CancelSeriesDialogProps {
  seriesId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelled: () => void
}

export function CancelSeriesDialog({
  seriesId,
  open,
  onOpenChange,
  onCancelled,
}: CancelSeriesDialogProps) {
  const toast = useAppToast()
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      const { cancelledAppointmentIds } = await cancelRecurringSeries(seriesId)
      const n = cancelledAppointmentIds.length
      toast.success(
        n === 0
          ? 'No upcoming visits left in this series'
          : `Series cancelled — ${n} upcoming visit${n === 1 ? '' : 's'} cancelled`
      )
      onOpenChange(false)
      onCancelled()
    } catch (err) {
      toast.error(bookingErrorMessage(err, 'Could not cancel the series. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel the whole series?</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-600">
            Every upcoming visit in this recurring series will be cancelled. Past and completed
            visits are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Keep series</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
            disabled={submitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {submitting ? 'Cancelling…' : 'Cancel series'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
