// Normalize to E.164, defaulting bare local numbers to Israel (+972). Deliberately
// narrow: this app's contacts are Israeli officials. A leading '+' (or '972') is
// treated as already-international; a leading '0' is an Israeli local number.
export function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 0) return null

  let e164: string
  if (hasPlus) {
    e164 = `+${digits}`
  } else if (digits.startsWith('972')) {
    e164 = `+${digits}`
  } else if (digits.startsWith('0')) {
    e164 = `+972${digits.slice(1)}`
  } else {
    return null // ambiguous — no country context
  }

  // E.164 is up to 15 digits, and an Israeli number is at least +972 + 8 local digits.
  const body = e164.slice(1)
  if (body.length < 11 || body.length > 15) return null
  return e164
}

export function phoneForWhatsapp(e164: string): string {
  return e164.replace(/\D/g, '')
}
