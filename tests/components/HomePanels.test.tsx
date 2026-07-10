import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// One fixed-height "stage" with a labeled section index (tabs) navigating panels:
// Who we are · Our MKs · FAQ · Meet us · Gallery. MK and Meet-us are conditional,
// so the tab count tracks the visible panels.
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
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia
  })

  it('renders five panels in one section with a labeled tab each', () => {
    const { container } = render(<HomePanels />)
    expect(container.querySelectorAll('section')).toHaveLength(1)
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    // Tabs carry short section labels…
    expect(screen.getByRole('tab', { name: 'שאלות' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'פגישה' })).toBeInTheDocument()
    // …and the panel content is present (full headings differ from the tab labels).
    expect(screen.getByRole('heading', { name: 'שאלות נפוצות' })).toBeInTheDocument()
    expect(screen.getByText('רוצים לפגוש אותנו?')).toBeInTheDocument()
    expect(screen.getByText('ח"כים ליברלים בליכוד')).toBeInTheDocument()
  })

  it('drops the MK tab when no MKs are annotated', () => {
    mockUseMkList.mockReturnValue({
      mks: [{ ...LIBERAL_MK, isLiberal: false, isSupporter: false }],
      loading: false, error: null,
    })
    render(<HomePanels />)
    expect(screen.queryByRole('tab', { name: 'ח"כים' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
  })

  it('drops the Meet Us tab when the flag is off', () => {
    useFeatureFlagsMock.mockReturnValue({})
    render(<HomePanels />)
    expect(screen.queryByRole('tab', { name: 'פגישה' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
  })

  it('selects a panel when its tab is clicked', async () => {
    render(<HomePanels />)
    const faqTab = screen.getByRole('tab', { name: 'שאלות' })
    expect(faqTab).toHaveAttribute('aria-selected', 'false')
    await userEvent.click(faqTab)
    expect(faqTab).toHaveAttribute('aria-selected', 'true')
  })

  it('navigates tabs with arrow keys (RTL: Left = forward, Right = back)', async () => {
    render(<HomePanels />)
    screen.getAllByRole('tab')[0].focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('jumps to first/last tab with Home/End', async () => {
    render(<HomePanels />)
    screen.getAllByRole('tab')[0].focus()
    await userEvent.keyboard('{End}')
    const tabs = screen.getAllByRole('tab')
    expect(tabs[tabs.length - 1]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Home}')
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')
  })

  // Regression: a fixed-height panel with `overflow-y-auto overscroll-contain`
  // traps vertical page scroll on mobile (overscroll-behavior: contain blocks the
  // swipe from chaining to <body>). Contain only the horizontal carousel axis.
  it('does not trap vertical page scroll (no vertical overscroll containment on panels)', () => {
    render(<HomePanels />)
    for (const panel of screen.getAllByRole('tabpanel')) {
      expect(panel.className).not.toMatch(/overscroll-contain\b/)
      expect(panel.className).not.toMatch(/overscroll-y-contain\b/)
    }
  })

  // Regression: navigation must scroll the carousel track only, never the window.
  // `scrollIntoView` walks up every scroll ancestor and yanks the whole page back to
  // this section on each 6s auto-advance, no matter where the user has scrolled.
  it('navigates without scrollIntoView (no page jump)', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    try {
      render(<HomePanels />)
      await userEvent.click(screen.getByRole('tab', { name: 'שאלות' }))
      expect(screen.getByRole('tab', { name: 'שאלות' })).toHaveAttribute('aria-selected', 'true')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('auto-advances to the next tab after the interval', () => {
    vi.useFakeTimers()
    try {
      render(<HomePanels />)
      const tabs = screen.getAllByRole('tab')
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
      act(() => { vi.advanceTimersByTime(6000) })
      expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true')
    } finally {
      vi.useRealTimers()
    }
  })
})
