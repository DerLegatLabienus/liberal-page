import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import type { HtmlCodeEditorProps } from './HtmlCodeEditor'

// Default export so it can be React.lazy-loaded (keeps CodeMirror out of the main bundle).
export default function CodeMirrorEditor({ value, onChange, placeholder, ariaLabel, minHeight }: HtmlCodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      minHeight={minHeight ?? '9rem'}
      theme="light"
      extensions={[html(), EditorView.lineWrapping]}
      basicSetup={{
        lineNumbers: true,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        autocompletion: false,
        highlightActiveLine: true,
      }}
    />
  )
}
