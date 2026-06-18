import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { admin: { letters: {
    create: vi.fn().mockResolvedValue({ letter: {} }),
    list: vi.fn().mockResolvedValue({ letters: [] }),
    contacts: { list: vi.fn().mockResolvedValue({ contacts: [
      { id: 1, displayName: 'דובר חינוך', email: 'dover@education.gov.il', category: 'ministry', createdAt: '' },
    ] }) },
    letterTemplates: { list: vi.fn().mockResolvedValue({ templates: [] }) },
  } } },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' }, ready: true }) }))
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({}) }))

import AdminLettersPage from '@/pages/AdminLettersPage'
import { MemoryRouter } from 'react-router-dom'
import { api } from '@/lib/api-client'

const renderPage = () => render(<MemoryRouter><AdminLettersPage /></MemoryRouter>)

describe('admin composer multi-recipient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a letter with a To recipient picked from the address book', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New Letter/ }))
    await user.type(screen.getByPlaceholderText('Internal title'), 'כותרת')
    await user.type(screen.getByPlaceholderText('Re: ...'), 'נושא')
    await user.type(screen.getByPlaceholderText(/<p>/), '<p>גוף</p>')
    // Add a To recipient via the address-book picker
    const toInput = screen.getAllByPlaceholderText(/הקלד/)[0]
    await user.type(toInput, 'דובר')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    await user.click(await screen.findByText(/dover@education.gov.il/))
    await user.click(screen.getByRole('button', { name: /Create Letter/ }))
    expect(api.admin.letters.create).toHaveBeenCalledWith(expect.objectContaining({
      toAddresses: [{ email: 'dover@education.gov.il', display_name: 'דובר חינוך', contact_id: 1 }],
    }))
  })

  it('blocks submit when there is no To recipient', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New Letter/ }))
    await user.type(screen.getByPlaceholderText('Internal title'), 'כותרת')
    await user.type(screen.getByPlaceholderText('Re: ...'), 'נושא')
    await user.type(screen.getByPlaceholderText(/<p>/), '<p>גוף</p>')
    await user.click(screen.getByRole('button', { name: /Create Letter/ }))
    expect(api.admin.letters.create).not.toHaveBeenCalled()
  })
})
