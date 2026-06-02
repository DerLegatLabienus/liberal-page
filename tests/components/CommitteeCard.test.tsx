import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CommitteeCard from '@/components/parliament/CommitteeCard'
import type { Committee, CommitteeSession } from '@/types'

const MK_FIXTURES = [
  { knesset_site_id: '1116', name: 'דן אילוז' },
]

function committeeFixture(overrides: Partial<Committee> = {}): Committee {
  return {
    id: 1,
    oknesset_id: '2',
    name: 'ועדת הכספים',
    chair: '',
    lastSessionDate: null,
    lastSessionSummary: null,
    lastSessionDocumentUrl: null,
    sourceUrl: 'https://main.knesset.gov.il/apps/committees/2213',
    hasNewData: false,
    lastPolledAt: null,
    ...overrides,
  }
}

const SESSION_EXTENDED: CommitteeSession = {
  sessionId: 2242870,
  date: '2026-05-13T09:30:00',
  knessetNum: 25,
  title: 'הצעת חוק לתיקון פקודת מס הכנסה',
  sessionUrl: 'https://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2242870',
  attendingSiteIds: ['1116'],
  aiSummary: 'דיון בהצעת חוק תיקון מס הכנסה',
}

const SESSION_COMPACT: CommitteeSession = {
  sessionId: 2241000,
  date: '2026-04-30T10:00:00',
  knessetNum: 25,
  title: 'הצעת חוק אחרת',
  sessionUrl: 'https://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2241000',
  attendingSiteIds: [],
}

describe('CommitteeCard', () => {
  it('renders committee name', () => {
    render(<CommitteeCard committee={committeeFixture()} trackedMks={[]} />)
    expect(screen.getByText('ועדת הכספים')).toBeInTheDocument()
  })

  it('renders most recent session title', () => {
    render(<CommitteeCard committee={committeeFixture({ recentSessions: [SESSION_EXTENDED, SESSION_COMPACT] })} trackedMks={[]} />)
    expect(screen.getByText('הצעת חוק לתיקון פקודת מס הכנסה')).toBeInTheDocument()
  })

  it('renders AI summary when present', () => {
    render(<CommitteeCard committee={committeeFixture({ recentSessions: [SESSION_EXTENDED] })} trackedMks={[]} />)
    expect(screen.getByText('דיון בהצעת חוק תיקון מס הכנסה')).toBeInTheDocument()
  })

  it('renders compact second session title', () => {
    render(<CommitteeCard committee={committeeFixture({ recentSessions: [SESSION_EXTENDED, SESSION_COMPACT] })} trackedMks={[]} />)
    expect(screen.getByText('הצעת חוק אחרת')).toBeInTheDocument()
  })

  it('does not render badge row when attendingSiteIds is empty', () => {
    const session = { ...SESSION_EXTENDED, attendingSiteIds: [] }
    render(<CommitteeCard committee={committeeFixture({ recentSessions: [session] })} trackedMks={[]} />)
    expect(screen.queryByText('💙')).not.toBeInTheDocument()
  })

  it('renders nothing for sessions when recentSessions is undefined', () => {
    render(<CommitteeCard committee={committeeFixture()} trackedMks={[]} />)
    expect(screen.queryByText(/הצעת חוק/)).not.toBeInTheDocument()
  })

  it('does not render MK attendance badge (attendingSiteIds feature not active)', () => {
    render(<CommitteeCard committee={committeeFixture({ recentSessions: [SESSION_EXTENDED] })} trackedMks={MK_FIXTURES} />)
    // Annotation badges removed — attendingSiteIds is always [] from the enricher
    expect(screen.queryByText('💙')).not.toBeInTheDocument()
  })

  it('renders a Closed badge when the committee is inactive, keeping sessions visible', () => {
    render(<CommitteeCard committee={committeeFixture({ inactive: true, recentSessions: [SESSION_EXTENDED] })} trackedMks={[]} />)
    expect(screen.getByText('סגורה')).toBeInTheDocument()
    expect(screen.getByText('הצעת חוק לתיקון פקודת מס הכנסה')).toBeInTheDocument()
  })

  it('does not render a Closed badge when the committee is active', () => {
    render(<CommitteeCard committee={committeeFixture({ inactive: false })} trackedMks={[]} />)
    expect(screen.queryByText('סגורה')).not.toBeInTheDocument()
  })

  it('renders all 4 sessions when recentSessions has 4 entries', () => {
    const sessions: CommitteeSession[] = [
      SESSION_EXTENDED,
      { ...SESSION_COMPACT, sessionId: 2241001, title: 'ישיבה שנייה' },
      { ...SESSION_COMPACT, sessionId: 2241002, title: 'ישיבה שלישית' },
      { ...SESSION_COMPACT, sessionId: 2241003, title: 'ישיבה רביעית' },
    ]
    render(<CommitteeCard committee={committeeFixture({ recentSessions: sessions })} trackedMks={[]} />)
    expect(screen.getByText('הצעת חוק לתיקון פקודת מס הכנסה')).toBeInTheDocument()
    expect(screen.getByText('ישיבה שנייה')).toBeInTheDocument()
    expect(screen.getByText('ישיבה שלישית')).toBeInTheDocument()
    expect(screen.getByText('ישיבה רביעית')).toBeInTheDocument()
  })
})
