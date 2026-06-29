import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// One horizontally-snapping section composing four panels:
// Who we are · Our MKs · FAQ · Meet us. MK and Meet-us panels are conditional,
// so we mock their data sources and assert the dot count tracks visible panels.
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

import HomePanels from '@/components/sections/HomePanels'

const LIBERAL_MK = { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false }

describe('HomePanels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMkList.mockReturnValue({ mks: [LIBERAL_MK], loading: false, error: null })
    useAuthOptionalMock.mockReturnValue({ user: null, ready: true })
    useFeatureFlagsMock.mockReturnValue({ meetUs: { enabled: true, value: 'et' } })
  })

  it('renders the four panels in one section with one dot each', () => {
    const { container } = render(<HomePanels />)
    expect(container.querySelectorAll('section')).toHaveLength(1)
    expect(screen.getByText('מי אנחנו')).toBeInTheDocument()        // who we are
    expect(screen.getByText('ח"כים ליברלים בליכוד')).toBeInTheDocument() // our MKs
    expect(screen.getByText('שאלות נפוצות')).toBeInTheDocument()    // FAQ
    expect(screen.getByText('רוצים לפגוש אותנו?')).toBeInTheDocument() // meet us
    expect(screen.getAllByTestId('panel-dot')).toHaveLength(4)
  })

  it('drops the MK panel (and its dot) when no MKs are annotated', () => {
    mockUseMkList.mockReturnValue({
      mks: [{ ...LIBERAL_MK, isLiberal: false, isSupporter: false }],
      loading: false, error: null,
    })
    render(<HomePanels />)
    expect(screen.queryByText('ח"כים ליברלים בליכוד')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('panel-dot')).toHaveLength(3)
  })

  it('drops the Meet Us panel when the flag is off', () => {
    useFeatureFlagsMock.mockReturnValue({})
    render(<HomePanels />)
    expect(screen.queryByText('רוצים לפגוש אותנו?')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('panel-dot')).toHaveLength(3)
  })

  it('marks the next panel active when the next control is clicked', async () => {
    render(<HomePanels />)
    const dotsBefore = screen.getAllByTestId('panel-dot')
    expect(dotsBefore[0]).toHaveAttribute('aria-current', 'true')
    await userEvent.click(screen.getByRole('button', { name: /הפאנל הבא/ }))
    expect(screen.getAllByTestId('panel-dot')[1]).toHaveAttribute('aria-current', 'true')
  })
})
