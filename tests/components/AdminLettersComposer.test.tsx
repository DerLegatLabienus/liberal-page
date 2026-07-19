import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => {
  const candidates = [
    { id: 1, displayName: 'דובר חינוך', email: 'dover@education.gov.il', phone: '050-1234567', hasWhatsapp: true, photoUrl: null, mkSiteId: null, category: 'ministry', createdAt: '' },
  ]
  return {
    api: {
      admin: { letters: {
        create: vi.fn().mockResolvedValue({ letter: {} }),
        update: vi.fn().mockResolvedValue({ letter: {} }),
        regenerateShares: vi.fn().mockResolvedValue({ regenerated: 3 }),
        list: vi.fn().mockResolvedValue({ letters: [] }),
        // Admin Contacts tab still uses this list endpoint.
        contacts: {
          list: vi.fn().mockResolvedValue({ contacts: candidates }),
          create: vi.fn().mockResolvedValue({ contact: candidates[0] }),
          update: vi.fn().mockResolvedValue({ ok: true }),
          delete: vi.fn().mockResolvedValue({ ok: true }),
        },
        letterTemplates: { list: vi.fn().mockResolvedValue({ templates: [] }) },
        media: { upload: vi.fn() },
      } },
      // Composer per-channel recipient pickers use the channel-filtered contacts endpoint.
      letters: { contacts: vi.fn().mockResolvedValue({ contacts: candidates }) },
    },
    // errorStatus reads the `status` field off thrown Error objects, same shape as the real client.
    errorStatus: (e: unknown) => (e as { status?: number } | null)?.status,
  }
})
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' }, ready: true }) }))
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({}) }))
vi.mock('@/hooks/useMkList', () => ({ useMkList: () => ({ mks: [], loading: false, error: null }) }))
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
  id: 7, title: 'כותרת קיימת',
  channels: [{
    id: 1, letterId: 7, kind: 'email', enabled: true,
    recipientIds: [1], ccIds: [], bccIds: [],
    bodyText: '', subject: 'נושא קיים', bodyHtml: '<p>גוף קיים</p>', templateId: null,
  }],
  issueTagIds: [], status: 'published', priority: 'normal', pinnedAt: null, activityScore: 0,
  publishedAt: null, createdAt: '', updatedAt: '', totalSends: 0, breakdown: {}, shareUrl: null,
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
      channels: expect.arrayContaining([
        expect.objectContaining({ kind: 'email', subject: 'נושא', bodyHtml: '<p>גוף</p>', recipientIds: [1] }),
      ]),
    }))
  })

  it('renders the (mocked) HTML editor on the Email tab', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New Letter/ }))
    // Email is enabled by default; the mocked HtmlCodeEditor exposes the body placeholder.
    expect(screen.getByPlaceholderText(/<p>/)).toBeInTheDocument()
  })

  it('enables the SMS tab, types a Hebrew body, and submits a sms channel', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New Letter/ }))
    await user.type(screen.getByPlaceholderText('Internal title'), 'כותרת')
    // Enable SMS (jumps to its tab), then disable Email so its fields aren't required.
    await user.click(screen.getByRole('checkbox', { name: /toggle SMS channel/ }))
    await user.click(screen.getByRole('checkbox', { name: /toggle Email channel/ }))
    await user.type(screen.getByLabelText('SMS body'), 'שלום זו הודעת SMS')
    await user.click(screen.getByRole('button', { name: /Create Letter/ }))
    expect(api.admin.letters.create).toHaveBeenCalledWith(expect.objectContaining({
      channels: expect.arrayContaining([
        expect.objectContaining({ kind: 'sms', bodyText: 'שלום זו הודעת SMS' }),
      ]),
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

  it('shows a copy-share-link button only for the row with a shareUrl, and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.admin.letters.list).mockResolvedValue({
      letters: [
        { ...existingLetter, id: 6, title: 'עם קישור שיתוף', shareUrl: 'https://cdn.example/letter/6.html' },
        { ...existingLetter, id: 8, title: 'ללא קישור שיתוף', shareUrl: null },
      ],
    })
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByText('עם קישור שיתוף')
    const buttons = screen.getAllByRole('button', { name: /קישור שיתוף/ })
    expect(buttons).toHaveLength(1)
    // happy-dom resets navigator.clipboard to its own getter during render, so the mock
    // must be installed after render (right before the interaction), not before.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await user.click(buttons[0])
    expect(writeText).toHaveBeenCalledWith('https://cdn.example/letter/6.html')
  })
})

describe('admin contacts tab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a contact with a phone number and WhatsApp toggled on', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^Contacts$/ }))
    await user.click(await screen.findByRole('button', { name: /New Contact/ }))
    await user.type(screen.getByPlaceholderText('Display name'), 'ישראל ישראלי')
    await user.type(screen.getByPlaceholderText(/05X/), '0501234567')
    await user.click(screen.getByRole('checkbox', { name: /has WhatsApp/ }))
    await user.click(screen.getByRole('button', { name: /Create Contact/ }))
    expect(api.admin.letters.contacts.create).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '0501234567', hasWhatsapp: true }),
    )
  })

  it('shows an inline "in use" message on a 409 delete and keeps the contact', async () => {
    const conflict = Object.assign(new Error('contact is used by a letter'), { status: 409 })
    vi.mocked(api.admin.letters.contacts.delete).mockRejectedValueOnce(conflict)
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^Contacts$/ }))
    await screen.findByText('דובר חינוך')
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(await screen.findByText(/לא ניתן למחוק/)).toBeInTheDocument()
    expect(screen.getByText('דובר חינוך')).toBeInTheDocument()
  })
})
