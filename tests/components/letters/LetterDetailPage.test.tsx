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

  it('defaults to the email channel and shows its letter in the pane', async () => {
    const { container } = renderAt()
    await screen.findByRole('button', { name: /שליחה במייל/ })
    expect(container.querySelector('iframe')).toBeInTheDocument()
  })

  it('renders exactly one send control per channel (the old stacked buttons are gone)', async () => {
    renderAt()
    await screen.findByRole('button', { name: /שליחה במייל/ })
    expect(screen.queryByRole('button', { name: /פתח ב-Gmail/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /העתק גוף/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /בלשונית חדשה/ })).not.toBeInTheDocument()
  })

  it('email primary click opens the mailto compose and records the send', async () => {
    const u = userEvent.setup({ delay: null })
    renderAt()
    await u.click(await screen.findByRole('button', { name: /שליחה במייל/ }))
    expect(api.letters.recordSend).toHaveBeenCalledWith(5, 'mailto')
  })

  it('switching to the SMS tab shows the message and sends to a chosen recipient', async () => {
    const u = userEvent.setup({ delay: null })
    renderAt()
    await u.click(await screen.findByRole('tab', { name: /SMS/ }))
    expect(screen.getByText('תוכן ההודעה')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /שליחה/ }))
    await u.click(screen.getByRole('menuitem', { name: /דן/ }))
    expect(api.letters.publicSend).toHaveBeenCalledWith(5, 'sms', 1)
  })

  it('shows no share-link button when the letter has no share page', async () => {
    renderAt()
    await screen.findByRole('button', { name: /שליחה במייל/ })
    expect(screen.queryByRole('button', { name: /קישור שיתוף/ })).not.toBeInTheDocument()
  })

  it('copies the share link — including for a letter with no email channel', async () => {
    // SMS-only letter: proves the share control lives in the header, reachable for a
    // letter that has no email channel at all.
    vi.mocked(api.letters.detail).mockResolvedValue({
      ...DETAIL,
      letter: { ...DETAIL.letter, shareUrl: 'https://cdn.example/letter/5.html' },
      channels: DETAIL.channels.filter((c) => c.kind === 'sms'),
    })
    const u = userEvent.setup({ delay: null })
    renderAt()
    const btn = await screen.findByRole('button', { name: /קישור שיתוף/ })

    // happy-dom re-installs its own navigator.clipboard getter during render, so the mock
    // has to go in after the component is on screen.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await u.click(btn)
    expect(writeText).toHaveBeenCalledWith('https://cdn.example/letter/5.html')
  })
})
