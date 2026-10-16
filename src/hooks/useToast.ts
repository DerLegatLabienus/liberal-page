import { useContext } from 'react'
import { ToastContext, type ToastContextValue } from '@/contexts/toast-context'

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

/** Returns null outside a provider (so standalone components/tests don't crash). */
export function useToastOptional(): ToastContextValue | null {
  return useContext(ToastContext)
}
