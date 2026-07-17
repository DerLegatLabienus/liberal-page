import type { LetterAddress } from '../types'
import { phoneForWhatsapp } from './phone'

/**
 * Build a mailto: URI with pre-filled fields. Per RFC 6068, hfields must be
 * percent-encoded with %20 for spaces — NOT URLSearchParams, which form-encodes
 * spaces as `+` that many mail clients render literally (mangling Hebrew subjects
 * and bodies). Email addresses are ASCII-safe so the to-list is left as-is.
 *
 * Pure + dependency-free so both the server (detail endpoint) and the client
 * (member recipient edits) build identical URLs from one source of truth.
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

/**
 * WhatsApp click-to-chat deep link. wa.me wants an international number with no
 * '+', spaces, or dashes. Opens the user's own WhatsApp with the text pre-filled;
 * no media parameter exists, so this carries text only.
 */
export function buildWhatsappUrl(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneForWhatsapp(phoneE164)}?text=${encodeURIComponent(text)}`
}

/**
 * SMS deep link. The `?&body=` form is deliberate cross-platform glue: iOS
 * historically wants `&body=`, Android `?body=`; `?&body=` is honored by both.
 * The '+' in the E.164 number is kept (dialers accept it).
 */
export function buildSmsUrl(phoneE164: string, text: string): string {
  return `sms:${phoneE164}?&body=${encodeURIComponent(text)}`
}
