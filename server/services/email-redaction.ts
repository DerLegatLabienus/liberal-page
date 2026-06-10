/** Redact an email for logs: keep the local part, drop the domain. 'a@b.com' -> 'a@…'. */
export function redactEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '…'
  return `${email.slice(0, at)}@…`
}
