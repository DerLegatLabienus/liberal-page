import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockUseCommitteeList = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useCommitteeList', () => ({ useCommitteeList: mockUseCommitteeList }))
vi.mock('@/lib/api-client', () => ({
  api: { committees: { track: vi.fn().mockResolvedValue({ ok: true }) } },
}))

import CommitteeCombobox from '@/components/parliament/CommitteeCombobox'
import { api } from '@/lib/api-client'

const DEFAULT_COMMITTEES = [
  { committeeId: 2, name: 'ועדת הכספים', knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2' },
  { committeeId: 3, name: 'ועדת החוץ והביטחון', knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=3' },
]

describe('CommitteeCombobox', () => {
  beforeEach(() => {
    mockUseCommitteeList.mockReturnValue({ committees: DEFAULT_COMMITTEES, loading: false, error: null })
    vi.mocked(api.committees.track).mockResolvedValue({ ok: true })
  })

  it('renders trigger button with placeholder text', () => {
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    expect(screen.getByText(/חפש ועדה/i)).toBeInTheDocument()
  })

  it('opens dropdown and shows committees on click', async () => {
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    expect(screen.getByText('ועדת הכספים')).toBeInTheDocument()
    expect(screen.getByText('ועדת החוץ והביטחון')).toBeInTheDocument()
  })

  it('filters by name when typing', async () => {
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    await user.type(screen.getByPlaceholderText(/חפש ועדה/i), 'כספים')
    expect(screen.getByText('ועדת הכספים')).toBeInTheDocument()
    expect(screen.queryByText('ועדת החוץ והביטחון')).not.toBeInTheDocument()
  })

  it('calls api.committees.track and onAdd when item clicked', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={onAdd} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    await user.click(screen.getByText('ועדת הכספים'))
    expect(api.committees.track).toHaveBeenCalledWith(2, 'ועדת הכספים', expect.stringContaining('commmid=2'))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
})

describe('CommitteeCombobox — edge cases', () => {
  beforeEach(() => {
    vi.mocked(api.committees.track).mockResolvedValue({ ok: true })
  })

  it('shows "no results" when list is empty', async () => {
    mockUseCommitteeList.mockReturnValue({ committees: [], loading: false, error: null })
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    expect(screen.getByText(/לא נמצאו תוצאות/i)).toBeInTheDocument()
  })

  it('shows loading indicator when loading is true', async () => {
    mockUseCommitteeList.mockReturnValue({ committees: [], loading: true, error: null })
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    expect(screen.getByText('...')).toBeInTheDocument()
  })

  it('renders committee items as buttons (not anchors) — tracking fires on click not navigation', async () => {
    mockUseCommitteeList.mockReturnValue({
      committees: [{ committeeId: 99, name: 'ועדה ללא קישור', knessetUrl: '' }],
      loading: false, error: null,
    })
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    const item = screen.getByRole('button', { name: /ועדה ללא קישור/i })
    expect(item.tagName).toBe('BUTTON')
    expect(item).not.toHaveAttribute('href')
  })

  it('filters results when searching', async () => {
    mockUseCommitteeList.mockReturnValue({ committees: DEFAULT_COMMITTEES, loading: false, error: null })
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    await user.type(screen.getByPlaceholderText(/חפש ועדה/i), 'כספים')
    expect(screen.getByText('ועדת הכספים')).toBeInTheDocument()
    expect(screen.queryByText('ועדת החוץ והביטחון')).not.toBeInTheDocument()
  })
})
