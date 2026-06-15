import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

/**
 * Top-level error boundary. Without one, a single render-time throw anywhere in the tree
 * unmounts the whole app and the user sees a blank white screen. This catches it and shows a
 * recoverable RTL fallback instead. Must be a class component (React has no hook equivalent).
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] uncaught render error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '60vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '1rem',
          fontFamily: 'Heebo, Arial, sans-serif', padding: '2rem', textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>אירעה שגיאה בלתי צפויה</h1>
        <p style={{ color: '#555' }}>אנו מתנצלים. נסו לרענן את הדף.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: '#0a4595', color: '#fff', border: 0, borderRadius: 6,
            padding: '0.5rem 1.25rem', cursor: 'pointer', fontSize: '0.95rem',
          }}
        >
          רענון הדף
        </button>
      </div>
    )
  }
}
