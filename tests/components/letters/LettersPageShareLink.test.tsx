import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Letter } from '@/types'

vi.mock('@/lib/api-client', () => ({
  api: { letters: { list: vi.fn(), tags: vi.fn().mockResolvedValue({ tags: [] }) } },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, ready: true }) }))
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ lettersEnabled: { enabled: true, value: '' } }) }))
vi.mock('@/components/layout/Header', () => ({ default: () => null }))
vi.mock('@/components/layout/Footer', () => ({ default: () => null }))

import LettersPage from '@/pages/LettersPage'
import { MemoryRouter } from 'react-router-dom'
import { api } from '@/lib/api-client'

const base: Letter = {
  id: 1, title: 'מכתב משותף', channels: [], issueTagIds: [], status: 'published',
  priority: 'normal', pinnedAt: null, activityScore: 0, publishedAt: null,
  createdAt: '', updatedAt: '',
}

const renderPage = () => render(<MemoryRouter><LettersPage /></MemoryRouter>)

describe('LettersPage share link', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the copy button only for letters that have a share page', async () => {
    vi.mocked(api.letters.list).mockResolvedValue({
      letters: [
        { ...base, id: 1, title: 'עם קישור', shareUrl: 'https://cdn.example/letter/1.html' },
        { ...base, id: 2, title: 'בלי קישור', shareUrl: null },
      ],
    })
    renderPage()
    await screen.findByText('עם קישור')
    // two cards render, but only the one with a shareUrl offers the control
    expect(screen.getAllByRole('button', { name: /קישור שיתוף/ })).toHaveLength(1)
  })

  it('makes the whole card a link to the letter, with no separate open button', async () => {
    vi.mocked(api.letters.list).mockResolvedValue({
      letters: [{ ...base, title: 'מכתב משותף', shareUrl: null }],
    })
    renderPage()
    // the card itself is the click target (stretched link), labelled by the letter title
    const link = await screen.findByRole('link', { name: 'מכתב משותף' })
    expect(link).toHaveAttribute('href', '/letters/1')
    // the redundant "open letter" button is gone
    expect(screen.queryByText('פתח מכתב')).not.toBeInTheDocument()
  })

  it('copies the share URL to the clipboard on click', async () => {
    vi.mocked(api.letters.list).mockResolvedValue({
      letters: [{ ...base, shareUrl: 'https://cdn.example/letter/1.html' }],
    })
    const u = userEvent.setup({ delay: null })
    renderPage()
    const btn = await screen.findByRole('button', { name: /קישור שיתוף/ })

    // happy-dom reinstalls its own navigator.clipboard getter during render — install after.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await u.click(btn)
    expect(writeText).toHaveBeenCalledWith('https://cdn.example/letter/1.html')
  })
})
