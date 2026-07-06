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
    const node = buildOgCardNode({
      id: 1, title: 'חוק הבריאות 2026', subject: '', bodyHtml: '', bodyPlain: '',
      recipientNames: [], issueTags: [],
    })
    const children = node.props.children as Array<{ props: { children: string } }>
    expect(children[1].props.children).toBe(toVisualOrder('חוק הבריאות 2026'))
  })
})

describe('renderShareHtml (public send page)', () => {
  const view = {
    id: 7, title: 'חוק הבריאות', subject: 'נושא', bodyHtml: '<p>גוף המכתב</p>', bodyPlain: 'גוף המכתב',
    recipientNames: ['ח"כ פלוני'], issueTags: ['בריאות'],
    toAddresses: [{ email: 'mk@knesset.gov.il', display_name: 'ח"כ פלוני' }], ccAddresses: [], bccAddresses: [],
  }
  const html = renderShareHtml(view, { shareBaseUrl: 'https://pub.r2.dev', appBaseUrl: 'https://app', apiBaseUrl: 'https://api' })

  it('has the OG image meta', () => {
    expect(html).toContain('property="og:image"')
    expect(html).toContain('https://pub.r2.dev/letter/7.png')
  })
  it('has a mailto send link to the MK with the subject and body', () => {
    expect(html).toContain('href="mailto:mk@knesset.gov.il?')
    expect(html).toContain('subject=' + encodeURIComponent('נושא'))
  })
  it('has a Gmail compose link', () => {
    expect(html).toContain('https://mail.google.com/mail/?')
  })
  it('embeds the letter body and a copy control', () => {
    expect(html).toContain('גוף המכתב')
    expect(html).toContain('id="copy-btn"')
  })
  it('tracks sends via sendBeacon to the public endpoint (action appended at runtime)', () => {
    expect(html).toContain('navigator.sendBeacon')
    expect(html).toContain('https://api/api/public/letters/7/send')
    expect(html).toContain("'?action=' + action")
  })
})

describe('renderShareHtml (Turnstile interstitial)', () => {
  const base = {
    id: 9, title: 'חוק', subject: 'נ', bodyHtml: '<p>גוף</p>', bodyPlain: 'גוף',
    recipientNames: ['ח"כ'], issueTags: ['בריאות'],
    toAddresses: [{ email: 'mk@k.il', display_name: 'ח"כ' }], ccAddresses: [], bccAddresses: [],
  }
  const optsBase = { shareBaseUrl: 'https://pub.r2.dev', appBaseUrl: 'https://app', apiBaseUrl: 'https://api' }

  it('bakes the widget + hidden content when a sitekey is provided', () => {
    const html = renderShareHtml(base, { ...optsBase, turnstileSiteKey: '0xSITEKEY' })
    expect(html).toContain('challenges.cloudflare.com/turnstile/v0/api.js')
    expect(html).toContain('data-sitekey="0xSITEKEY"')
    expect(html).toContain('id="letter-content" hidden')
    expect(html).toContain('id="gate-fallback"')            // fallback escape hatch
    expect(html).toContain('turnstile.getResponse')          // token read at send time
  })

  it('renders no wall and visible content when the sitekey is absent (unchanged)', () => {
    const html = renderShareHtml(base, optsBase)
    expect(html).not.toContain('cf-turnstile')
    expect(html).not.toContain('turnstile/v0/api.js')
    expect(html).toContain('id="letter-content"')            // present but NOT hidden
    expect(html).not.toContain('id="letter-content" hidden')
  })
})
