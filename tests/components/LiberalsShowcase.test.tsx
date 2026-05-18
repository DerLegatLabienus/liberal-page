import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

const { mockUseMkList } = vi.hoisted(() => ({
  mockUseMkList: vi.fn(),
}))

vi.mock('@/hooks/useMkList', () => ({ useMkList: mockUseMkList }))
vi.mock('@/components/parliament/MkActivityCard', () => ({
  default: ({ member }: { member: { name: string } }) => <div data-testid="mk-card">{member.name}</div>,
}))

import LiberalsShowcase from '@/components/sections/LiberalsShowcase'

describe('LiberalsShowcase', () => {
  it('returns null when no annotated MKs', () => {
    mockUseMkList.mockReturnValue({
      mks: [{ siteId: 999, name: 'יריב לוין', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: false }],
      loading: false, error: null,
    })
    const { container } = render(<LiberalsShowcase />)
    expect(container.firstChild).toBeNull()
  })

  it('renders MkActivityCard for each liberal MK', () => {
    mockUseMkList.mockReturnValue({
      mks: [
        { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
        { siteId: 1117, name: 'משה רוט', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
        { siteId: 999, name: 'יריב לוין', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: false },
      ],
      loading: false, error: null,
    })
    render(<LiberalsShowcase />)
    expect(screen.getAllByTestId('mk-card')).toHaveLength(2)
  })

  it('renders supporter MKs alongside liberal MKs', () => {
    mockUseMkList.mockReturnValue({
      mks: [
        { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
        { siteId: 888, name: 'בועז ביסמוט', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: true },
      ],
      loading: false, error: null,
    })
    render(<LiberalsShowcase />)
    expect(screen.getAllByTestId('mk-card')).toHaveLength(2)
  })
})
