import { lazy, Suspense } from 'react'

export interface HtmlCodeEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  minHeight?: string
}

// Deferred so CodeMirror is code-split into the admin chunk, not the main bundle.
const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor'))

/** Plain-textarea fallback: used while CodeMirror loads, if the chunk fails, and as the
 *  mock target in page tests (CodeMirror does not run under happy-dom). */
export function FallbackTextarea({ value, onChange, placeholder, ariaLabel, minHeight }: HtmlCodeEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full rounded border px-3 py-1.5 font-mono text-sm"
      style={{ minHeight: minHeight ?? '9rem' }}
    />
  )
}

export default function HtmlCodeEditor(props: HtmlCodeEditorProps) {
  // Force LTR: the surrounding document is dir="rtl", but code reads left-to-right.
  return (
    <div dir="ltr" className="overflow-hidden rounded border text-sm [&_.cm-editor]:rounded">
      <Suspense fallback={<FallbackTextarea {...props} />}>
        <CodeMirrorEditor {...props} />
      </Suspense>
    </div>
  )
}
