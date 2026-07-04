import { describe, it, expect } from 'vitest'
import { renderShareHtml, buildOgCardNode, type ShareLetterView } from '../../server/services/share-renderer'
import { toVisualOrder } from '../../server/services/bidi'

const view: ShareLetterView = {
  id: 42,
  title: 'עצרו את חוק X',
  subject: 'בקשה דחופה',
  bodyHtml: '<p>שלום רב, אנו פונים אליך</p>',
  bodyPlain: 'שלום רב, אנו פונים אליך בבקשה לפעול בנושא החשוב הזה למען חירות הפרט והשוק החופשי בישראל.',
  recipientNames: ['ח"כ ישראל ישראלי'],
  issueTags: ['חירות אזרחית'],
}
const opts = { shareBaseUrl: 'https://share.example.org', appBaseUrl: 'https://app.example.org/liberal-page' }

describe('renderShareHtml', () => {
  const html = renderShareHtml(view, opts)
  it('sets RTL Hebrew document', () => {
    expect(html).toContain('<html lang="he" dir="rtl">')
  })
  it('emits Open Graph tags with title, description, image and url', () => {
    expect(html).toContain('<meta property="og:title" content="עצרו את חוק X">')
    expect(html).toContain('property="og:image" content="https://share.example.org/letter/42.png"')
    expect(html).toContain('property="og:url" content="https://share.example.org/letter/42.html"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    // description = first ~150 chars of bodyPlain
    expect(html).toMatch(/property="og:description" content="שלום רב/)
  })
  it('links the CTA into the app with src=share', () => {
    expect(html).toContain('href="https://app.example.org/liberal-page/letters/42?src=share"')
  })
  it('includes the sanitized body and recipient names', () => {
    expect(html).toContain('<p>שלום רב, אנו פונים אליך</p>')
    expect(html).toContain('ח"כ ישראל ישראלי')
  })
})

describe('buildOgCardNode', () => {
  it('reorders the card title to visual order', () => {
    // buildOgCardNode only reads `title`; cast a partial view so this test doesn't
    // couple to unrelated ShareLetterView fields (which grow in Task 3).
    const node: any = buildOgCardNode({ id: 1, title: 'חוק הבריאות 2026' } as any)
    expect(node.props.children[1].props.children).toBe(toVisualOrder('חוק הבריאות 2026'))
  })
})
