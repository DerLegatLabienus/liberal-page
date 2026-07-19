import { describe, it, expect } from 'vitest'
import { renderShareHtml, type ShareLetterView } from '../../server/services/share-renderer'

// Regression tripwire for task 17b: the mocked share-publisher.test.ts only asserts R2 keys,
// so it can't catch a share page silently going blank. This test drives the REAL
// renderShareHtml (no mock) with a view shaped like syncShareForLetter now builds it — content
// sourced from letter_channels via buildChannelSends, not the empty legacy letters columns —
// and asserts the actual email + per-recipient sms content lands in the output HTML.

const view: ShareLetterView = {
  id: 101,
  title: 'מכתב לדוגמה',
  recipientNames: ['ח"כ ישראל ישראלי', 'דנה כהן', 'יוסי לוי'],
  issueTags: ['חירות אזרחית'],
  email: {
    subject: 'בקשה דחופה בנושא החוק',
    bodyHtml: '<p>שלום רב, אנו פונים אליך בבקשת דחיפות.</p>',
    bodyPlain: 'שלום רב, אנו פונים אליך בבקשת דחיפות.',
    mailtoUrl: 'mailto:mk@knesset.gov.il?subject=%D7%91%D7%A7%D7%A9%D7%94&body=%D7%92%D7%95%D7%A3',
    gmailUrl: 'https://mail.google.com/mail/?view=cm&fs=1&to=mk%40knesset.gov.il&su=%D7%91%D7%A7%D7%A9%D7%94&body=%D7%92%D7%95%D7%A3',
  },
  channels: [
    {
      kind: 'sms',
      bodyText: 'הודעת בדיקה לשיתוף',
      recipients: [
        { contactId: 501, displayName: 'דנה כהן', url: 'sms:+972500000001?&body=%D7%92%D7%95%D7%A3' },
        { contactId: 502, displayName: 'יוסי לוי', url: 'sms:+972500000002?&body=%D7%92%D7%95%D7%A3' },
      ],
    },
  ],
}

const opts = { shareBaseUrl: 'https://pub.example.org', appBaseUrl: 'https://app.example.org', apiBaseUrl: 'https://api.example.org' }

describe('renderShareHtml — real content assembled from channels (no mocks)', () => {
  const html = renderShareHtml(view, opts)

  it('renders the email bodyHtml', () => {
    expect(html).toContain('<p>שלום רב, אנו פונים אליך בבקשת דחיפות.</p>')
  })

  it('renders the pre-built mailto and gmail hrefs from the email ChannelSend', () => {
    // href values are HTML-attribute-escaped (& -> &amp;), same as any other attribute.
    const escAmp = (s: string) => s.replace(/&/g, '&amp;')
    expect(html).toContain(`href="${escAmp(view.email!.mailtoUrl)}"`)
    expect(html).toContain(`href="${escAmp(view.email!.gmailUrl)}"`)
  })

  it('renders both sms recipient links with their contactId-carrying beacon data attributes', () => {
    expect(html).toContain('href="sms:+972500000001?&amp;body=%D7%92%D7%95%D7%A3"')
    expect(html).toContain('data-contact-id="501"')
    expect(html).toContain('שליחה לדנה כהן')

    expect(html).toContain('href="sms:+972500000002?&amp;body=%D7%92%D7%95%D7%A3"')
    expect(html).toContain('data-contact-id="502"')
    expect(html).toContain('שליחה ליוסי לוי')
  })

  it('wires the recipient links to the sms track kind via data-kind', () => {
    expect(html).toContain('data-kind="sms"')
  })

  it('renders the sms message body as visible content, not only percent-encoded inside an href', () => {
    // Strip href attribute values before asserting, so a match can only come from visible markup.
    const withoutHrefs = html.replace(/href="[^"]*"/g, 'href="STRIPPED"')
    expect(withoutHrefs).toContain('הודעת בדיקה לשיתוף')
    // Channel bodies use their own class ("chan-body"), not the email's ".body" — so the
    // copy-to-clipboard script's `.body` selector keeps resolving to the email body only.
    expect(html).toContain('<div class="chan-body">הודעת בדיקה לשיתוף</div>')
  })

  it('renders a multi-line channel body with preserved newlines (white-space: pre-wrap on .chan-body)', () => {
    const multiline: ShareLetterView = {
      ...view,
      channels: [
        {
          kind: 'sms',
          bodyText: 'שורה ראשונה\nשורה שנייה\nשורה שלישית',
          recipients: [{ contactId: 501, displayName: 'דנה כהן', url: 'sms:+972500000001?&body=x' }],
        },
      ],
    }
    const multilineHtml = renderShareHtml(multiline, opts)
    // esc() doesn't touch newlines — they must survive raw inside the chan-body div, and the
    // page's CSS carries `white-space: pre-wrap` on .chan-body so they render as line breaks.
    expect(multilineHtml).toContain('<div class="chan-body">שורה ראשונה\nשורה שנייה\nשורה שלישית</div>')
    expect(multilineHtml).toMatch(/\.chan-body\s*\{[^}]*white-space:\s*pre-wrap/)
  })

  it('the copy script still targets the email .body, unaffected by the channel body\'s class rename', () => {
    expect(html).toContain("document.querySelector('.body')")
    expect(html).toContain('<div class="body">')
  })
})

describe('renderShareHtml — WhatsApp channels', () => {
  const whatsappView: ShareLetterView = {
    id: 102,
    title: 'מכתב לדוגמה',
    recipientNames: ['ח"כ ישראל ישראלי', 'דנה כהן'],
    issueTags: ['חירות אזרחית'],
    email: {
      subject: 'בקשה דחופה בנושא החוק',
      bodyHtml: '<p>שלום רב, אנו פונים אליך בבקשת דחיפות.</p>',
      bodyPlain: 'שלום רב, אנו פונים אליך בבקשת דחיפות.',
      mailtoUrl: 'mailto:mk@knesset.gov.il?subject=%D7%91%D7%A7%D7%A9%D7%94&body=%D7%92%D7%95%D7%A3',
      gmailUrl: 'https://mail.google.com/mail/?view=cm&fs=1&to=mk%40knesset.gov.il&su=%D7%91%D7%A7%D7%A9%D7%94&body=%D7%92%D7%95%D7%A3',
    },
    channels: [
      {
        kind: 'whatsapp',
        bodyText: 'הודעת בדיקה לשיתוף בוואטסאפ',
        recipients: [
          { contactId: 601, displayName: 'דנה כהן', url: 'https://wa.me/+972500000001' },
          { contactId: 602, displayName: 'יוסי לוי', url: 'https://wa.me/+972500000002' },
        ],
      },
    ],
  }

  const html = renderShareHtml(whatsappView, opts)

  it('renders WhatsApp recipient links with target="_blank" rel="noopener noreferrer"', () => {
    expect(html).toContain('href="https://wa.me/+972500000001"')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('data-kind="whatsapp"')
    expect(html).toContain('שליחה לדנה כהן')
  })

  it('wires WhatsApp recipient links to the whatsapp track kind', () => {
    expect(html).toContain('data-kind="whatsapp"')
  })

  it('renders the whatsapp message body as visible content, not only percent-encoded inside an href', () => {
    const withoutHrefs = html.replace(/href="[^"]*"/g, 'href="STRIPPED"')
    expect(withoutHrefs).toContain('הודעת בדיקה לשיתוף בוואטסאפ')
    expect(html).toContain('<div class="chan-body">הודעת בדיקה לשיתוף בוואטסאפ</div>')
  })
})
