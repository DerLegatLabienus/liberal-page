import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import MkCard from '@/components/parliament/MkCard'
import type { Mk } from '@/types'
import mksData from '../../src/data/mks.json'

// Real Knesset data sourced from OData API via knesset-scraper
const mk1116 = mksData.find((m) => m.knesset_site_id === '1116')! as unknown as Mk
const mk1117 = mksData.find((m) => m.knesset_site_id === '1117')! as unknown as Mk

// Minimal valid Mk for edge-case tests
function mkFixture(overrides: Partial<Mk>): Mk {
  return {
    id: 99,
    oknesset_id: '00000',
    name: 'ח"כ בדיקה',
    party: 'מפלגת הבדיקה',
    email: null,
    photoUrl: 'https://example.com/photo.jpg',
    currentRoles: [],
    activity: [],
    recentVotes: [],
    votingSummary: null,
    sourceUrl: 'https://example.com/mk/99',
    hasNewData: false,
    lastPolledAt: null,
    ...overrides,
  }
}

describe('MkCard — real Knesset data (site ID 1116: דן אילוז)', () => {
  it('renders MK name', () => {
    render(<MkCard mk={mk1116} />)
    expect(screen.getByText('דן אילוז')).toBeInTheDocument()
  })

  it('renders party name', () => {
    render(<MkCard mk={mk1116} />)
    expect(screen.getByText('הליכוד')).toBeInTheDocument()
  })

  it('renders photo with Knesset photo URL', () => {
    render(<MkCard mk={mk1116} />)
    const img = screen.getByRole('img', { name: 'דן אילוז' })
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://main.knesset.gov.il/mk/members/1116/photo')
  })

  it('shows exactly 4 activity items (capped)', () => {
    const activity = Array.from({ length: 6 }, (_, i) => ({
      type: 'bill_initiated' as const,
      date: `2026-0${i + 1}-01T00:00:00`,
      title: `הצעת חוק ${i + 1}`,
      sourceUrl: `https://example.com/bill/${i + 1}`,
    }))
    render(<MkCard mk={mkFixture({ name: 'דן אילוז', activity })} />)
    const icons = screen.getAllByText('📋')
    expect(icons).toHaveLength(4)
  })

  it('does not show the 5th activity item', () => {
    const activity = Array.from({ length: 6 }, (_, i) => ({
      type: 'bill_initiated' as const,
      date: `2026-0${i + 1}-01T00:00:00`,
      title: `הצעת חוק ${i + 1}`,
      sourceUrl: `https://example.com/bill/${i + 1}`,
    }))
    render(<MkCard mk={mkFixture({ name: 'דן אילוז', activity })} />)
    expect(screen.queryByText('הצעת חוק 5')).not.toBeInTheDocument()
  })

  it('shows formatted Hebrew date for each activity item', () => {
    const activity = [{
      type: 'bill_initiated' as const,
      date: '2026-05-14T10:00:00',
      title: 'הצעת חוק בדיקה',
      detail: 'פרטית',
      sourceUrl: 'https://example.com/bill/1',
    }]
    render(<MkCard mk={mkFixture({ activity })} />)
    expect(screen.getByText(/14\.5\.2026/)).toBeInTheDocument()
  })

  it('renders source link pointing to Knesset MK page', () => {
    render(<MkCard mk={mk1116} />)
    const link = screen.getByRole('link', { name: /צפה במקור/i })
    expect(link).toHaveAttribute('href', 'https://main.knesset.gov.il/mk/Apps/mk/mk-positions/1116')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('calls onRemove with correct id when remove button clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<MkCard mk={mk1116} onRemove={onRemove} />)

    await user.click(screen.getByRole('button', { name: 'הסר' }))
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledWith(mk1116.id)
  })
})

describe('MkCard — real Knesset data (site ID 1117: משה רוט)', () => {
  it('renders MK name', () => {
    render(<MkCard mk={mk1117} />)
    expect(screen.getByText('משה רוט')).toBeInTheDocument()
  })

  it('renders party יהדות התורה', () => {
    render(<MkCard mk={mk1117} />)
    expect(screen.getByText('יהדות התורה')).toBeInTheDocument()
  })

  it('shows ❓ icon for question activity type', () => {
    // 1117 has a question-type activity but it falls beyond the 4-item cap.
    // Promote it to first position using mkFixture so the icon is visible.
    const questionActivity = {
      type: 'question' as const,
      date: '2023-07-30T19:28:35.523',
      title: "חסימה פתאומית של כבישים מהירים על-ידי צוותות של חברת 'נתיבי ישראל'",
      detail: 'רגילה',
      sourceUrl: 'https://main.knesset.gov.il/Activity/Legislation/Questions/Pages/QueryDetails.aspx?QueryId=2207933',
    }
    const mk = mkFixture({ name: 'משה רוט', party: 'יהדות התורה', activity: [questionActivity] })
    render(<MkCard mk={mk} />)
    expect(screen.getByText('❓')).toBeInTheDocument()
    expect(screen.getByText(questionActivity.title)).toBeInTheDocument()
  })
})

describe('MkCard — edge cases', () => {
  it('shows fallback text when name is empty', () => {
    render(<MkCard mk={mkFixture({ name: '' })} />)
    expect(screen.getByText('ח"כ לא מוגדר')).toBeInTheDocument()
  })

  it('does not render img when photoUrl is null', () => {
    render(<MkCard mk={mkFixture({ photoUrl: null })} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('does not render party line when party is empty string', () => {
    const mk = mkFixture({ party: '', name: 'ח"כ ללא מפלגה' })
    const { container } = render(<MkCard mk={mk} />)
    expect(screen.getByText('ח"כ ללא מפלגה')).toBeInTheDocument()
    // The name wrapper div should contain exactly one <p> (name only, no party)
    const nameWrapper = container.querySelector('.min-w-0')!
    expect(nameWrapper.querySelectorAll('p')).toHaveLength(1)
  })

  it('does not render activity section when activity and recentVotes are empty', () => {
    render(<MkCard mk={mkFixture({ activity: [], recentVotes: [] })} />)
    expect(screen.queryByText('פעילות אחרונה')).not.toBeInTheDocument()
    expect(screen.queryByText('הצבעות אחרונות:')).not.toBeInTheDocument()
  })

  it('does not render remove button when onRemove is not provided', () => {
    render(<MkCard mk={mkFixture({})} />)
    expect(screen.queryByRole('button', { name: 'הסר' })).not.toBeInTheDocument()
  })

  it('renders votingSummary when provided', () => {
    const summary = 'תמך ברוב ח"כ הליכוד בהצבעות הקואליציוניות'
    render(<MkCard mk={mkFixture({ votingSummary: summary })} />)
    expect(screen.getByText(summary)).toBeInTheDocument()
    expect(screen.getByText(/סיכום הצבעות/)).toBeInTheDocument()
  })

  it('renders recentVotes fallback when activity is empty', () => {
    const mk = mkFixture({
      activity: [],
      recentVotes: [{ date: '2026-01-01', billTitle: 'הצעת חוק בדיקה', vote: 'בעד' }],
    })
    render(<MkCard mk={mk} />)
    expect(screen.getByText('הצבעות אחרונות:')).toBeInTheDocument()
    expect(screen.getByText('הצעת חוק בדיקה')).toBeInTheDocument()
    expect(screen.getByText('בעד')).toBeInTheDocument()
  })
})
