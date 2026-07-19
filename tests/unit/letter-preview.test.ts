import { describe, it, expect } from 'vitest'
import { buildLetterPreviewDoc } from '@/lib/letter-preview'

describe('buildLetterPreviewDoc', () => {
  it('wraps a bare (untemplated) body in an RTL utf-8 document', () => {
    const doc = buildLetterPreviewDoc('שלום עולם')
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('dir="rtl"')
    expect(doc).toContain('charset="utf-8"')
    expect(doc).toContain('text-align: right')
    expect(doc).toContain('שלום עולם')
  })

  it('preserves templated HTML verbatim inside the shell', () => {
    const templated = '<div dir="rtl" style="font-family:Heebo">תוכן</div>'
    const doc = buildLetterPreviewDoc(templated)
    expect(doc).toContain(templated)
  })

  it('does not escape or mangle the supplied html', () => {
    const doc = buildLetterPreviewDoc('<p>a &amp; b</p>')
    expect(doc).toContain('<p>a &amp; b</p>')
  })
})
