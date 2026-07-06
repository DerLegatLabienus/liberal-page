export type TurnstileResult = 'verified' | 'rejected' | 'skip'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Verify a Turnstile token via Cloudflare siteverify.
 *  Returns 'skip' when the secret is unconfigured so the caller can fail open
 *  on misconfiguration rather than silently zeroing the send metric. */
export async function verifyTurnstile(token: string, remoteip?: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    console.warn('[turnstile] TURNSTILE_SECRET_KEY unset — skipping verification (fail-open)')
    return 'skip'
  }
  if (!token) return 'rejected'
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteip) body.set('remoteip', remoteip)
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body })
    if (!res.ok) return 'rejected'
    const data = (await res.json()) as { success?: boolean }
    return data.success === true ? 'verified' : 'rejected'
  } catch (err) {
    console.error('[turnstile] siteverify failed:', err)
    return 'rejected'
  }
}
