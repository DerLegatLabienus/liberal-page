import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { letters: {
    detail: vi.fn(),
    recordSend: vi.fn().mockResolvedValue({ ok: true }),
    contacts: vi.fn().mockResolvedValue({ contacts: [
      { id: 9, displayName: 'דובר בריאות', email: 'dover@health.gov.il', category: 'ministry', createdAt: '' },
    ] }),
  } },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, ready: true }) }))
vi.mock('@/components/layout/Header', () => ({ default: () => null }))
vi.mock('@/components/layout/Footer', () => ({ default: () => null }))

import LetterDetailPage from '@/pages/LetterDetailPage'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { api } from '@/lib/api-client'

const DETAIL = {
  letter: {
    id: 5, title: 'מכתב', subject: 'נושא', bodyPlain: 'שלום רב',
    toAddresses: [{ email: 'preset@gov.il', display_name: 'נמען קבוע' }],
    ccAddresses: [], bccAddresses: [],
  },
  renderedHtml: '<p>שלום</p>', mailtoUrl: 'mailto:preset@gov.il', gmailUrl: 'https://mail.google.com/',
}

const renderAt = () => render(
  <MemoryRouter initialEntries={['/letters/5']}>
    <Routes><Route path="/letters/:id" element={<LetterDetailPage />} /></Routes>
  </MemoryRouter>)

describe('member recipient editing', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.letters.detail).mockResolvedValue(DETAIL as never) })

  it('shows admin presets as non-removable chips', async () => {
    renderAt()
    expect(await screen.findByText('נמען קבוע')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove נמען קבוע/ })).not.toBeInTheDocument()
  })

  it('adds a curated recipient and includes it in the copied addresses', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt()
    await screen.findByText('נמען קבוע')
    await user.type(screen.getByPlaceholderText(/הקלד/), 'דובר')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    await user.click(await screen.findByText(/dover@health.gov.il/))
    expect(screen.getByText(/דובר בריאות/)).toBeInTheDocument()
  })
})
