import { LetterTemplatesRepository } from '../repositories/letter-templates-repository'
import type { LetterAddress } from '../db/schema'

const templatesRepo = new LetterTemplatesRepository()

/** Strip all HTML tags, collapse whitespace. Used to generate body_plain from body_html. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Inject body_html into the chosen letter template's {{CONTENT}} placeholder.
 * Returns body_html unmodified if no templateId is provided or template not found.
 */
export async function renderLetterHtml(bodyHtml: string, templateId: number | null | undefined): Promise<string> {
  if (!templateId) return bodyHtml
  const template = await templatesRepo.getById(templateId)
  if (!template) return bodyHtml
  return template.html.replace('{{CONTENT}}', bodyHtml)
}

/**
 * Build a mailto: URI with pre-filled fields. Per RFC 6068, hfields must be
 * percent-encoded with %20 for spaces — NOT URLSearchParams, which form-encodes
 * spaces as `+` that many mail clients render literally (mangling Hebrew subjects
 * and bodies). Email addresses are ASCII-safe so the to-list is left as-is.
 */
export function buildMailtoUrl(
  toAddresses: LetterAddress[],
  ccAddresses: LetterAddress[],
  bccAddresses: LetterAddress[],
  subject: string,
  bodyPlain: string,
): string {
  const to = toAddresses.map((a) => a.email).join(',')
  const hfields: string[] = []
  if (ccAddresses.length) hfields.push(`cc=${encodeURIComponent(ccAddresses.map((a) => a.email).join(','))}`)
  if (bccAddresses.length) hfields.push(`bcc=${encodeURIComponent(bccAddresses.map((a) => a.email).join(','))}`)
  hfields.push(`subject=${encodeURIComponent(subject)}`)
  hfields.push(`body=${encodeURIComponent(bodyPlain)}`)
  return `mailto:${to}?${hfields.join('&')}`
}

/**
 * Build a Gmail web "compose" URL. mailto: only works on desktop when a protocol
 * handler is registered (often nothing happens on Chrome); this opens Gmail's compose
 * window directly in the browser, which works regardless of handler config.
 */
export function buildGmailComposeUrl(
  toAddresses: LetterAddress[],
  ccAddresses: LetterAddress[],
  bccAddresses: LetterAddress[],
  subject: string,
  bodyPlain: string,
): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1' })
  params.set('to', toAddresses.map((a) => a.email).join(','))
  if (ccAddresses.length) params.set('cc', ccAddresses.map((a) => a.email).join(','))
  if (bccAddresses.length) params.set('bcc', bccAddresses.map((a) => a.email).join(','))
  params.set('su', subject)
  params.set('body', bodyPlain)
  // Gmail decodes + as space in su/body, so URLSearchParams' + encoding is fine here.
  return `https://mail.google.com/mail/?${params.toString()}`
}
