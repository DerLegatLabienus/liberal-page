import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'

const API_BASE = 'https://api.calendly.com'
export const MEET_US_FLAG = 'meetUs'

const flagsRepo = new FeatureFlagsRepository()

export class CalendlyError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}

export interface ActiveMeeting { startTime: string; cancelUrl: string; rescheduleUrl: string }

let orgUri: string | null = null

/** Test-only: forget cached state so env/flag changes take effect. */
export function _resetCalendly(): void { orgUri = null }

function token(): string | null { return process.env.CALENDLY_API_TOKEN || null }

async function eventTypeUri(): Promise<string | null> {
  const flags = await flagsRepo.getAll()
  const flag = flags[MEET_US_FLAG]
  if (!flag?.enabled || !flag.value) return null
  return flag.value
}

/** Token present AND the meetUs flag is enabled with an event-type URI. */
export async function isConfigured(): Promise<boolean> {
  if (!token()) return false
  return (await eventTypeUri()) !== null
}

async function calendlyGet<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
  })
  console.info(`[api] GET ${url} → ${res.status}`)
  if (!res.ok) throw new CalendlyError(`Calendly GET ${path} failed: ${res.status}`, res.status)
  return res.json() as Promise<T>
}

async function getOrgUri(): Promise<string> {
  if (orgUri) return orgUri
  const me = await calendlyGet<{ resource: { current_organization: string } }>('/users/me')
  orgUri = me.resource.current_organization
  return orgUri
}

/**
 * The visitor's active upcoming meeting, or null. Live query — Calendly is the source of
 * truth for the one-active-booking gate; nothing is persisted on our side.
 */
export async function findActiveMeeting(email: string): Promise<ActiveMeeting | null> {
  const org = await getOrgUri()
  const q = new URLSearchParams({
    organization: org,
    invitee_email: email,
    status: 'active',
    min_start_time: new Date().toISOString(),
  })
  const events = await calendlyGet<{ collection: Array<{ uri: string; start_time: string }> }>(
    `/scheduled_events?${q}`,
  )
  const event = events.collection[0]
  if (!event) return null

  const eventUuid = event.uri.split('/').pop()
  const invitees = await calendlyGet<{ collection: Array<{ cancel_url: string; reschedule_url: string }> }>(
    `/scheduled_events/${eventUuid}/invitees?${new URLSearchParams({ email })}`,
  )
  const invitee = invitees.collection[0]
  return {
    startTime: event.start_time,
    cancelUrl: invitee?.cancel_url ?? '',
    rescheduleUrl: invitee?.reschedule_url ?? '',
  }
}

/** A one-shot Calendly booking link for the configured event type. */
export async function createSingleUseLink(): Promise<string> {
  const owner = await eventTypeUri()
  if (!owner) throw new CalendlyError('meetUs event type not configured')
  const schedulingUrl = `${API_BASE}/scheduling_links`
  const res = await fetch(schedulingUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_event_count: 1, owner, owner_type: 'EventType' }),
  })
  console.info(`[api] POST ${schedulingUrl} → ${res.status}`)
  if (!res.ok) throw new CalendlyError(`Calendly POST /scheduling_links failed: ${res.status}`, res.status)
  const body = (await res.json()) as { resource: { booking_url: string } }
  return body.resource.booking_url
}
