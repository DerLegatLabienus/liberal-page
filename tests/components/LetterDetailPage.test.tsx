import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { letters: {
    detail: vi.fn(),
    recordSend: vi.fn().mockResolvedValue({ ok: true }),
    publicSend: vi.fn().mockResolvedValue(undefined),
  } },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, ready: true }) }))
vi.mock('@/components/layout/Header', () => ({ default: () => null }))
vi.mock('@/components/layout/Footer', () => ({ default: () => null }))

import LetterDetailPage from '@/pages/LetterDetailPage'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { api } from '@/lib/api-client'
import type { LetterDetailResponse } from '@/types'

const DETAIL: LetterDetailResponse = {
  letter: {
    id: 5, title: 'מכתב', channels: [], issueTagIds: [], status: 'published',
    priority: 'normal', pinnedAt: null, activityScore: 0, publishedAt: null,
    createdAt: '', updatedAt: '',
  },
  channels: [
    {
      kind: 'email', enabled: true, bodyText: '', unavailableCount: 0,
      gmailUrl: 'https://mail.google.com/mail/?view=cm',
      mailtoUrl: 'mailto:preset@gov.il', renderedHtml: '<p>hi</p>',
    },
    {
      kind: 'sms', enabled: true, bodyText: 'תוכן ההודעה', unavailableCount: 0,
      recipients: [
        { contactId: 1, displayName: 'דן', photoUrl: null, url: 'sms:+972500000001?&body=x' },
        { contactId: 2, displayName: 'מיכל', photoUrl: null, url: 'sms:+972500000002?&body=x' },
      ],
    },
  ],
}

const renderAt = () => render(
  <MemoryRouter initialEntries={['/letters/5']}>
    <Routes><Route path="/letters/:id" element={<LetterDetailPage />} /></Routes>
  </MemoryRouter>)

describe('LetterDetailPage (channels)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.letters.detail).mockResolvedValue(DETAIL)
    // sms recipient click navigates via window.location.href — stub to a plain writable object
    // so happy-dom doesn't attempt real navigation on the `sms:` scheme.
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true })
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  it('renders the Gmail email action', async () => {
    renderAt()
    expect(await screen.findByRole('button', { name: /Gmail/ })).toBeInTheDocument()
  })

  it('renders one send button per SMS recipient', async () => {
    renderAt()
    expect(await screen.findByRole('button', { name: /דן/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /מיכל/ })).toBeInTheDocument()
  })

  it('renders the SMS message body text', async () => {
    renderAt()
    expect(await screen.findByText('תוכן ההודעה')).toBeInTheDocument()
  })

  it('records a public send with (id, "sms", contactId) when an SMS recipient is clicked', async () => {
    const u = userEvent.setup({ delay: null })
    renderAt()
    await u.click(await screen.findByRole('button', { name: /דן/ }))
    expect(api.letters.publicSend).toHaveBeenCalledWith(5, 'sms', 1)
  })
})
