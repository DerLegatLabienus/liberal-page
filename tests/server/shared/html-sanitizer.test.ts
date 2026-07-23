import { describe, it, expect } from 'vitest'
import { sanitizeLetterHtml } from '../../../server/services/html-sanitizer'

describe('sanitizeLetterHtml', () => {
  it('strips <script> entirely (tag and contents)', () => {
    const out = sanitizeLetterHtml('<p>hi</p><script>alert(1)</script>')
    expect(out).toContain('<p>hi</p>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert')
  })

  it('removes event-handler attributes like onerror', () => {
    const out = sanitizeLetterHtml('<img src="x" onerror="alert(1)">')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert')
  })

  it('drops javascript: URLs on links', () => {
    const out = sanitizeLetterHtml('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toContain('javascript:')
  })

  it('keeps basic formatting, dir, style, and http(s) images', () => {
    const html = '<div dir="rtl" style="text-align:right"><p>שלום</p><img src="https://likudliberal.org/logo.png" alt="logo"></div>'
    const out = sanitizeLetterHtml(html)
    expect(out).toContain('dir="rtl"')
    expect(out).toContain('<p>שלום</p>')
    expect(out).toContain('https://likudliberal.org/logo.png')
  })

  it('preserves multi-property inline styles (the seeded templates rely on them on re-save)', () => {
    const out = sanitizeLetterHtml('<div style="text-align:right;font-family:Heebo,Arial,sans-serif;line-height:1.7;color:#1a1a1a">x</div>')
    expect(out).toContain('text-align:right')
    expect(out).toContain('font-family:Heebo')
  })

  it('preserves the {{CONTENT}} template placeholder', () => {
    const out = sanitizeLetterHtml('<div dir="rtl">{{CONTENT}}</div>')
    expect(out).toContain('{{CONTENT}}')
  })

  it('strips <style> blocks', () => {
    const out = sanitizeLetterHtml('<style>body{display:none}</style><p>x</p>')
    expect(out).not.toContain('display:none')
    expect(out).toContain('<p>x</p>')
  })
})
