import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: {
    bills: {
      search: vi.fn(),
      track: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
}))

import BillSearchCombobox from '@/components/parliament/BillSearchCombobox'
import { api } from '@/lib/api-client'

const RESULTS = [
  { billId: 1038990, name: 'הצעת חוק חופש העיסוק', knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990' },
  { billId: 1040059, name: 'הצעת חוק חינוך חופשי', knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1040059' },
]

describe('BillSearchCombobox', () => {
  beforeEach(() => {
    vi.mocked(api.bills.search).mockResolvedValue(RESULTS)
    vi.mocked(api.bills.track).mockResolvedValue({ ok: true })
  })

  it('renders the search input', () => {
    render(<BillSearchCombobox onAdd={vi.fn()} />)
    expect(screen.getByPlaceholderText(/חפש הצ"ח/i)).toBeInTheDocument()
  })

  it('does not search when fewer than 3 chars typed', async () => {
    const user = userEvent.setup()
    render(<BillSearchCombobox onAdd={vi.fn()} />)
    await user.type(screen.getByPlaceholderText(/חפש הצ"ח/i), 'חו')
    expect(api.bills.search).not.toHaveBeenCalled()
  })

  it('shows results after 3+ chars (debounce bypassed in test)', async () => {
    const user = userEvent.setup({ delay: null })
    render(<BillSearchCombobox onAdd={vi.fn()} />)
    await user.type(screen.getByPlaceholderText(/חפש הצ"ח/i), 'חופש')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    expect(api.bills.search).toHaveBeenCalledWith('חופש')
    expect(await screen.findByText('הצעת חוק חופש העיסוק')).toBeInTheDocument()
  })

  it('calls api.bills.track and onAdd when a result is clicked', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup({ delay: null })
    render(<BillSearchCombobox onAdd={onAdd} />)
    await user.type(screen.getByPlaceholderText(/חפש הצ"ח/i), 'חופש')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    await user.click(await screen.findByText('הצעת חוק חופש העיסוק'))
    expect(api.bills.track).toHaveBeenCalledWith(
      1038990,
      'הצעת חוק חופש העיסוק',
      expect.stringContaining('1038990'),
      undefined,
    )
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('applies max-h-[40vh] class to scrollable list container for mobile responsiveness', async () => {
    const user = userEvent.setup({ delay: null })
    render(<BillSearchCombobox onAdd={vi.fn()} />)
    await user.type(screen.getByPlaceholderText(/חפש הצ"ח/i), 'חופש')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    const listContainer = await screen.findByText('הצעת חוק חופש העיסוק')
    const scrollableDiv = listContainer.closest('div.overflow-y-auto')
    expect(scrollableDiv).toHaveClass('max-h-[40vh]')
  })
})
