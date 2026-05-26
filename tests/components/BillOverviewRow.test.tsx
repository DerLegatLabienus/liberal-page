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
})
