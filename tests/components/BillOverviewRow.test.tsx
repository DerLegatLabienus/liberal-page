import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import BillOverviewRow from '@/components/parliament/BillOverviewRow'

const BILL = {
  billId: 1, title: 'הצעת חוק חופש העיסוק', statusId: 101, status: 'הכנה לקריאה ראשונה',
  committee: '', lastUpdatedDate: '2026-05-01', summary: 'תקציר החוק', knessetUrl: 'https://k/1',
}

describe('BillOverviewRow', () => {
  it('shows title and status in compact view, hides summary until expanded', () => {
    render(<BillOverviewRow bill={BILL} />)
    expect(screen.getByText('הצעת חוק חופש העיסוק')).toBeInTheDocument()
    expect(screen.getByText('הכנה לקריאה ראשונה')).toBeInTheDocument()
    expect(screen.queryByText('תקציר החוק')).not.toBeInTheDocument()
  })

  it('expands to show summary and Knesset link on click', async () => {
    render(<BillOverviewRow bill={BILL} />)
    await userEvent.click(screen.getByRole('button', { name: /הצעת חוק חופש העיסוק/ }))
    expect(screen.getByText('תקציר החוק')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /קישור לכנסת/ })
    expect(link).toHaveAttribute('href', 'https://k/1')
  })

  it('renders the curated reason when present', async () => {
    render(<BillOverviewRow bill={{ ...BILL, reason: 'סיבה ליברלית' }} />)
    await userEvent.click(screen.getByRole('button', { name: /הצעת חוק חופש העיסוק/ }))
    expect(screen.getByText('סיבה ליברלית')).toBeInTheDocument()
  })

  it('title span has min-w-0 class for proper text truncation', () => {
    const longTitle = 'ה'.repeat(100)
    render(<BillOverviewRow bill={{ ...BILL, title: longTitle }} />)
    const titleSpan = screen.getByText(longTitle)
    expect(titleSpan).toHaveClass('min-w-0')
    expect(titleSpan).toHaveClass('flex-1')
    expect(titleSpan).toHaveClass('truncate')
  })

  it('committee paragraph has max-w-[10rem] and truncate classes in expanded view', async () => {
    const longCommitteeName = 'ועדת הכספים והתקציב והפרטיות והאבטחה'
    render(<BillOverviewRow bill={{ ...BILL, committee: longCommitteeName }} />)
    const button = screen.getByRole('button')
    await userEvent.click(button)
    const committeeP = screen.getByText(longCommitteeName)
    expect(committeeP).toHaveClass('max-w-[10rem]')
    expect(committeeP).toHaveClass('truncate')
  })
})
