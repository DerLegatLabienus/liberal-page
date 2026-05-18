import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

const { mockUseMkActivity } = vi.hoisted(() => ({
  mockUseMkActivity: vi.fn(),
}))

vi.mock('@/hooks/useMkActivity', () => ({ useMkActivity: mockUseMkActivity }))

import MkActivityCard from '@/components/parliament/MkActivityCard'
import type { KnessetMember } from '@/types'

const MEMBER: KnessetMember = {
  siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null,
  isLiberal: true, isSupporter: false,
}

describe('MkActivityCard', () => {
  it('shows spinner while loading', () => {
    mockUseMkActivity.mockReturnValue({ activity: null, loading: true, error: null })
    render(<MkActivityCard member={MEMBER} />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows MK name when loaded', () => {
    mockUseMkActivity.mockReturnValue({ activity: [], loading: false, error: null })
    render(<MkActivityCard member={MEMBER} />)
    expect(screen.getByText('דן אילוז')).toBeInTheDocument()
  })

  it('shows error message when fetch failed', () => {
    mockUseMkActivity.mockReturnValue({ activity: null, loading: false, error: 'Network error' })
    render(<MkActivityCard member={MEMBER} />)
    expect(screen.getByText(/Network error/i)).toBeInTheDocument()
  })
})
