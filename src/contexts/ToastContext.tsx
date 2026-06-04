import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'error' | 'success' | 'info'
interface Toast { id: number; message: string; type: ToastType }
interface ToastContextValue { toast: (message: string, type?: ToastType) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

/** Returns null outside a provider (so standalone components/tests don't crash). */
export function useToastOptional(): ToastContextValue | null {
  return useContext(ToastContext)
}

const DISMISS_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), DISMISS_MS)
  }, [])

  // Render the toast stack via a portal to <body> so no ancestor stacking/overflow context
  // can hide a fired toast. Inline styles + explicit colors guarantee visibility regardless
  // of the CSS pipeline. z-index above everything (drawer/dialog use 40–50).
  const stack = (
    <div
      data-testid="toast-stack"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 16, zIndex: 2147483647,
               display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
               padding: '0 16px', pointerEvents: 'none' }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          style={{ pointerEvents: 'auto', maxWidth: 420, borderRadius: 8, padding: '8px 16px',
                   fontSize: 14, color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,.25)',
                   background: t.type === 'error' ? '#dc2626' : t.type === 'success' ? '#059669' : '#0f172a' }}
        >
          {t.message}
        </div>
      ))}
    </div>
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {typeof document !== 'undefined' ? createPortal(stack, document.body) : stack}
    </ToastContext.Provider>
  )
}
