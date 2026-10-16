import { createContext } from 'react'

export type ToastType = 'error' | 'success' | 'info'
export interface ToastContextValue { toast: (message: string, type?: ToastType) => void }

export const ToastContext = createContext<ToastContextValue | null>(null)
