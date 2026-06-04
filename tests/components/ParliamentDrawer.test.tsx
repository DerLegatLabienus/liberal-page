import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import ParliamentDrawer from '@/components/layout/ParliamentDrawer'
import type { Bill, Committee, Mk } from '@/types'

const mockBills: Bill[] = [
  {
    id: 1, oknesset_id: '', number: 'פ/1', title: 'הצעת חוק בדיקה',
    status: 'בוועדה', position: 'תומכים', notes: '', committee: 'ועדת בדיקה',
    sourceUrl: '', documentUrl: null, hasNewData: false, lastPolledAt: null,
  },
]

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  bills: mockBills,
  committees: [] as Committee[],
  mks: [] as Mk[],
  loading: false,
  lastSyncedAt: null,
  onRefresh: vi.fn(),
  onAdd: vi.fn(),
  onRemoveBill: vi.fn(),
  onRemoveCommittee: vi.fn(),
  onRemoveMk: vi.fn(),
  scope: 'group' as const,
  onScopeChange: vi.fn(),
  canEdit: false,
  isLoggedIn: false,
}

describe('ParliamentDrawer', () => {
  it('renders bill title in the bills tab', () => {
    render(<ParliamentDrawer {...defaultProps} />)
    expect(screen.getByText('הצעת חוק בדיקה')).toBeInTheDocument()
  })

  it('uses an opaque native site surface for the drawer shell', () => {
    render(<ParliamentDrawer {...defaultProps} />)
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveClass('bg-white')
  })

  it('dims the list (aria-busy) while loading a scope switch, opaque when idle', () => {
    const { rerender } = render(<ParliamentDrawer {...defaultProps} loading={true} />)
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy).not.toBeNull()
    expect(busy).toHaveClass('opacity-40')

    rerender(<ParliamentDrawer {...defaultProps} loading={false} />)
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('switches to committees tab on click', async () => {
    const user = userEvent.setup()
    render(<ParliamentDrawer {...defaultProps} />)

    await user.click(screen.getByRole('tab', { name: /ועדות/i }))
    expect(screen.getByText(/אין ועדות במעקב/i)).toBeInTheDocument()
  })
})
