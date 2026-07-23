import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import ParliamentStrip from '@/components/sections/ParliamentStrip'

const BILL = {
  id: 1, oknesset_id: 'b1', number: '1', title: 'הצעת חוק חופש העיסוק',
  status: 'בוועדה' as const, position: 'תומכים' as const,
  notes: '', committee: '', sourceUrl: '', documentUrl: null, hasNewData: false,
}

describe('ParliamentStrip', () => {
  it('does not render a constitution link (it lives in the hero CTA)', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const constitutionLink = screen
      .queryAllByRole('link')
      .find((l) => l.getAttribute('href') === '/constitution')
    expect(constitutionLink).toBeFalsy()
  })

  it('bill cards do not have shrink-0 (allows wrapping on narrow screens)', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[BILL]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const card = document.querySelector('[class*="border-s-4"]')
    expect(card).not.toBeNull()
    expect(card!.className).not.toContain('shrink-0')
  })

  it('bill cards use responsive min-width (min-w-[150px] on mobile)', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[BILL]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const card = document.querySelector('[class*="border-s-4"]')
    expect(card!.className).toContain('min-w-[150px]')
  })

  it('"more" button spans full width on mobile (w-full sm:w-auto)', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const moreBtn = screen.getByText(/עוד נתונים/i).closest('button')!
    expect(moreBtn.className).toContain('w-full')
    expect(moreBtn.className).toContain('sm:w-auto')
  })
})
