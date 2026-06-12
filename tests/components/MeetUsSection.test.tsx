import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Google button mock: a plain button that fires onSuccess with a credential.
vi.mock('@react-oauth/google', () => ({
  GoogleLogin: (props: { onSuccess: (c: { credential: string }) => void }) => (
    <button onClick={() => props.onSuccess({ credential: 'idtok' })}>google-verify</button>
  ),
}))

const { bookingLink, useAuthOptionalMock, useFeatureFlagsMock } = vi.hoisted(() => ({
  bookingLink: vi.fn(),
  useAuthOptionalMock: vi.fn(),
  useFeatureFlagsMock: vi.fn(),
}))
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, api: { ...actual.api, meetings: { bookingLink } } }
})
vi.mock('@/contexts/AuthContext', () => ({ useAuthOptional: useAuthOptionalMock }))
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlags: useFeatureFlagsMock }))

import MeetUsSection from '@/components/sections/MeetUsSection'

describe('MeetUsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthOptionalMock.mockReturnValue({ user: null, ready: true })
    useFeatureFlagsMock.mockReturnValue({ meetUs: { enabled: true, value: 'et' } })
  })

  it('renders nothing when the flag is disabled', () => {
    useFeatureFlagsMock.mockReturnValue({})
    const { container } = render(<MeetUsSection />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for signed-in members', () => {
    useAuthOptionalMock.mockReturnValue({ user: { id: 1 }, ready: true })
    const { container } = render(<MeetUsSection />)
    expect(container.firstChild).toBeNull()
  })

  it('requests a booking link with the Google credential', async () => {
    bookingLink.mockResolvedValue({ status: 200, body: { bookingUrl: 'https://calendly.com/d/abc', name: 'N', email: 'e@x.com' } })
    render(<MeetUsSection />)
    await userEvent.click(screen.getByText('google-verify'))
    expect(bookingLink).toHaveBeenCalledWith('idtok')
  })

  it('shows the existing meeting on 409 active_meeting', async () => {
    bookingLink.mockResolvedValue({
      status: 409,
      body: { error: 'active_meeting', meeting: { startTime: '2026-07-01T10:00:00Z', cancelUrl: 'https://c', rescheduleUrl: 'https://r' } },
    })
    render(<MeetUsSection />)
    await userEvent.click(screen.getByText('google-verify'))
    await waitFor(() => expect(screen.getByText(/כבר קבועה לכם פגישה/)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'ביטול הפגישה' })).toHaveAttribute('href', 'https://c')
    expect(screen.getByRole('link', { name: 'שינוי מועד' })).toHaveAttribute('href', 'https://r')
  })
})
