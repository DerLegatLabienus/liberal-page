import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { admin: { letters: {
    create: vi.fn().mockResolvedValue({ letter: {} }),
    update: vi.fn().mockResolvedValue({ letter: {} }),
    regenerateShares: vi.fn().mockResolvedValue({ regenerated: 3 }),
    list: vi.fn().mockResolvedValue({ letters: [] }),
    contacts: { list: vi.fn().mockResolvedValue({ contacts: [
      { id: 1, displayName: 'דובר חינוך', email: 'dover@education.gov.il', category: 'ministry', createdAt: '' },
    ] }) },
    letterTemplates: { list: vi.fn().mockResolvedValue({ templates: [] }) },
  } } },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' }, ready: true }) }))
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({}) }))
// CodeMirror doesn't run under happy-dom; mock the editor to a plain textarea that
// forwards placeholder/value/onChange so the existing typing assertions keep working.
vi.mock('@/components/admin/HtmlCodeEditor', () => ({
  default: ({ value, onChange, placeholder, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import AdminLettersPage from '@/pages/AdminLettersPage'
import { MemoryRouter } from 'react-router-dom'
import { api } from '@/lib/api-client'
import type { LetterWithStats } from '@/types'

const renderPage = () => render(<MemoryRouter><AdminLettersPage /></MemoryRouter>)

const existingLetter: LetterWithStats = {
  id: 7, title: 'כותרת קיימת', subject: 'נושא קיים', bodyHtml: '<p>גוף קיים</p>', bodyPlain: 'גוף קיים',
  templateId: null, toAddresses: [{ email: 'mk@k.il', display_name: 'ח"כ' }], ccAddresses: [], bccAddresses: [],
  issueTagIds: [], status: 'published', priority: 'normal', pinnedAt: null, activityScore: 0,
  publishedAt: null, createdAt: '', updatedAt: '', totalSends: 0, breakdown: {},
}

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

  it('refetches templates when the composer opens', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('button', { name: /New Letter/ })
    const before = vi.mocked(api.admin.letters.letterTemplates.list).mock.calls.length
    await user.click(screen.getByRole('button', { name: /New Letter/ }))
    expect(vi.mocked(api.admin.letters.letterTemplates.list).mock.calls.length).toBeGreaterThan(before)
  })

  it('shows a live preview of the body wrapped in the selected template', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New Letter/ }))
    await user.type(screen.getByPlaceholderText(/<p>/), '<p>שלום</p>')
    expect(screen.getByTitle('composer-preview')).toBeInTheDocument()
  })

  it('edits an existing letter: opens the composer prefilled and PUTs on Save', async () => {
    vi.mocked(api.admin.letters.list).mockResolvedValue({ letters: [existingLetter] })
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^Edit$/ }))
    // composer opens in edit mode, pre-filled with the standard editor + fields
    expect(await screen.findByRole('heading', { name: /Edit Letter/ })).toBeInTheDocument()
    const titleInput = screen.getByDisplayValue('כותרת קיימת')
    expect(titleInput).toBeInTheDocument()
    expect(screen.getByDisplayValue('<p>גוף קיים</p>')).toBeInTheDocument() // body HTML pre-filled in the (mocked) editor
    await user.clear(titleInput)
    await user.type(titleInput, 'כותרת חדשה')
    await user.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(api.admin.letters.update).toHaveBeenCalledWith(7, expect.objectContaining({ title: 'כותרת חדשה' }))
    expect(api.admin.letters.create).not.toHaveBeenCalled()
  })

  it('regenerate-share-pages button calls the endpoint and shows the result', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Regenerate share pages/ }))
    expect(api.admin.letters.regenerateShares).toHaveBeenCalled()
    expect(await screen.findByText(/Regenerated 3 share pages/)).toBeInTheDocument()
  })
})
