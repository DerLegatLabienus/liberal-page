import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/hooks/useMkList', () => ({
  useMkList: () => ({
    mks: [
      { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
      { siteId: 999, name: 'יריב לוין', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: false },
      { siteId: 888, name: 'בועז ביסמוט', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: true },
    ],
    loading: false,
    error: null,
  }),
}))

import MkCombobox from '@/components/parliament/MkCombobox'
import type { KnessetMember } from '@/types'

describe('MkCombobox', () => {
  it('renders the search placeholder when nothing is selected', () => {
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    expect(screen.getByText('חפש ח"כ...')).toBeInTheDocument()
  })

  it('opens dropdown and shows all MKs when clicked', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    expect(screen.getByText('דן אילוז')).toBeInTheDocument()
    expect(screen.getByText('יריב לוין')).toBeInTheDocument()
  })

  it('filters results by name when typing', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    await user.type(screen.getByPlaceholderText('חפש ח"כ...'), 'יריב')
    expect(screen.getByText('יריב לוין')).toBeInTheDocument()
    expect(screen.queryByText('דן אילוז')).not.toBeInTheDocument()
  })

  it('calls onSelect with the member when an item is clicked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<MkCombobox onSelect={onSelect} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    await user.click(screen.getByText('דן אילוז'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 1116 }) as KnessetMember
    )
  })

  it('shows liberal badge for isLiberal MK', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    expect(screen.getByText(/ליברל/i)).toBeInTheDocument()
  })

  it('shows supporter badge for isSupporter MK', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    expect(screen.getByText(/תומך/i)).toBeInTheDocument()
  })

  it('shows selected MK name when selectedSiteId is set', () => {
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={1116} />)
    expect(screen.getByText('דן אילוז')).toBeInTheDocument()
  })

  it('applies max-h-[40vh] class to scrollable list container for mobile responsiveness', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    const listContainer = screen.getByText('דן אילוז').closest('div.overflow-y-auto')
    expect(listContainer).toHaveClass('max-h-[40vh]')
  })
})
