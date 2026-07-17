export type SmsEncoding = 'gsm7' | 'ucs2'

export interface SmsSegmentInfo {
  encoding: SmsEncoding
  units: number
  segments: number
  perSegment: number
  remaining: number
}

// The GSM 03.38 basic character set (chars encodable in a single 7-bit unit).
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
// Chars that ARE GSM-7 but occupy two 7-bit units (escape + char).
const GSM7_EXTENDED = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€'])

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (GSM7_EXTENDED.has(ch)) continue
    if (GSM7_BASIC.indexOf(ch) === -1) return false
  }
  return true
}

export function analyzeSms(text: string): SmsSegmentInfo {
  const gsm7 = isGsm7(text)
  const encoding: SmsEncoding = gsm7 ? 'gsm7' : 'ucs2'

  // Count billable units: GSM-7 extended chars are 2 units; everything else is 1.
  // UCS-2 counts by code points (astral chars would be 2 UTF-16 units, but our
  // content is Hebrew/Latin BMP — code-point count is correct here).
  let units = 0
  for (const ch of text) units += gsm7 && GSM7_EXTENDED.has(ch) ? 2 : 1

  const single = gsm7 ? 160 : 70
  const multi = gsm7 ? 153 : 67

  let segments: number
  let perSegment: number
  if (units <= single) {
    segments = units === 0 ? 1 : 1
    perSegment = single
  } else {
    segments = Math.ceil(units / multi)
    perSegment = multi
  }

  const capacity = segments * perSegment
  return { encoding, units, segments, perSegment, remaining: capacity - units }
}
