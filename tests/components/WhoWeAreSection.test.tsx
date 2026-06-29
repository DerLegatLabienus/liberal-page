import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The merged "Who we are" section composes About + values + MK cards + Meet Us.
// Each conditional sub-block keeps its own guard, so we mock their data sources.
const { mockUseMkList, useAuthOptionalMock, useFeatureFlagsMock, bookingLink } = vi.hoisted(() => ({
  mockUseMkList: vi.fn(),
  useAuthOptionalMock: vi.fn(),
  useFeatureFlagsMock: vi.fn(),
  bookingLink: vi.fn(),
}))

vi.mock('@/hooks/useMkList', () => ({ useMkList: mockUseMkList }))
vi.mock('@/components/parliament/MkActivityCard', () => ({
  default: ({ member }: { member: { name: string } }) => <div data-testid="mk-card">{member.name}</div>,
}))
vi.mock('@react-oauth/google', () => ({
  GoogleLogin: (props: { onSuccess: (c: { credential: string }) => void }) => (
    <button onClick={() => props.onSuccess({ credential: 'idtok' })}>google-verify</button>
  ),
}))
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, api: { ...actual.api, meetings: { bookingLink } } }
})
vi.mock('@/contexts/AuthContext', () => ({ useAuthOptional: useAuthOptionalMock }))
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlags: useFeatureFlagsMock }))

import WhoWeAreSection from '@/components/sections/WhoWeAreSection'

const LIBERAL_MK = { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false }

describe('WhoWeAreSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMkList.mockReturnValue({ mks: [LIBERAL_MK], loading: false, error: null })
    useAuthOptionalMock.mockReturnValue({ user: null, ready: true })
    useFeatureFlagsMock.mockReturnValue({ meetUs: { enabled: true, value: 'et' } })
  })

  it('renders all four sub-blocks in one section when data is present', () => {
    const { container } = render(<WhoWeAreSection />)
    // Exactly one <section> wrapper for the whole identity block.
    expect(container.querySelectorAll('section')).toHaveLength(1)
    // Who we are + what we follow
    expect(screen.getByText('מי אנחנו')).toBeInTheDocument()
    expect(screen.getByText('חירות הפרט')).toBeInTheDocument()
    // Our MKs
    expect(screen.getByText('ח"כים ליברלים בליכוד')).toBeInTheDocument()
    expect(screen.getByTestId('mk-card')).toBeInTheDocument()
    // Meet us
    expect(screen.getByText('רוצים לפגוש אותנו?')).toBeInTheDocument()
    expect(screen.getByText('google-verify')).toBeInTheDocument()
  })

  it('hides the MK sub-block when there are no annotated MKs', () => {
    mockUseMkList.mockReturnValue({
      mks: [{ ...LIBERAL_MK, isLiberal: false, isSupporter: false }],
      loading: false, error: null,
    })
    render(<WhoWeAreSection />)
    expect(screen.queryByTestId('mk-card')).not.toBeInTheDocument()
    expect(screen.queryByText('ח"כים ליברלים בליכוד')).not.toBeInTheDocument()
    // The rest of the identity section still renders.
    expect(screen.getByText('מי אנחנו')).toBeInTheDocument()
  })

  it('hides the Meet Us sub-block when the meetUs flag is off', () => {
    useFeatureFlagsMock.mockReturnValue({})
    render(<WhoWeAreSection />)
    expect(screen.queryByText('google-verify')).not.toBeInTheDocument()
    expect(screen.queryByText('רוצים לפגוש אותנו?')).not.toBeInTheDocument()
    expect(screen.getByText('מי אנחנו')).toBeInTheDocument()
  })
})
