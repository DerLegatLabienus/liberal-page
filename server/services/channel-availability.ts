import type { ChannelKind } from '../../src/types'

export type ContactLike = { email: string | null; phone: string | null; hasWhatsapp: boolean }

/** True if a contact can be reached on the given channel. */
export function reachableOn(kind: ChannelKind, c: ContactLike): boolean {
  if (kind === 'email') return !!c.email
  if (kind === 'sms') return !!c.phone
  return !!c.phone && c.hasWhatsapp // whatsapp
}
