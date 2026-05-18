import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/hooks/useCommitteeList', () => ({
  useCommitteeList: () => ({
    committees: [
      { committeeId: 2, name: 'ועדת הכספים', knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2' },
      { committeeId: 3, name: 'ועדת החוץ והביטחון', knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=3' },
    ],
    loading: false, error: null,
  }),
}))
vi.mock('@/lib/api-client', () => ({
  api: { committees: { track: vi.fn().mockResolvedValue({ ok: true }) } },
}))

import CommitteeCombobox from '@/components/parliament/CommitteeCombobox'
import { api } from '@/lib/api-client'

describe('CommitteeCombobox', () => {
  beforeEach(() => vi.mocked(api.committees.track).mockResolvedValue({ ok: true }))

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
