'use client'

import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

type ToastVariant = 'success' | 'error' | 'info' | 'warning'

export function useAppToast() {
  const show = useCallback((variant: ToastVariant, message: string) => {
    switch (variant) {
      case 'success':
        toast.success(message)
        break
      case 'error':
        toast.error(message)
        break
      case 'info':
        toast.info(message)
        break
      case 'warning':
        toast.warning(message)
        break
    }
  }, [])

  const success = useCallback((message: string) => show('success', message), [show])
  const error = useCallback((message: string) => show('error', message), [show])
  const info = useCallback((message: string) => show('info', message), [show])
  const warning = useCallback((message: string) => show('warning', message), [show])

  return useMemo(
    () => ({ success, error, info, warning, show }),
    [success, error, info, warning, show]
  )
}
