import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import ParliamentStrip from '@/components/sections/ParliamentStrip'
import type { Bill, Committee } from '@/types'

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

describe('ParliamentStrip — design tokens only', () => {
  // Raw Tailwind palette classes, including variant-prefixed ones (hover:bg-blue-50, ring-blue-600/50 …).
  const PALETTE_CLASS = /^(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?$/

  function paletteClasses(container: HTMLElement): string[] {
    return [container, ...Array.from(container.querySelectorAll('*'))]
      .flatMap((el) => Array.from(el.classList))
      .filter((c) => PALETTE_CLASS.test(c))
  }

  const COMMITTEE: Committee = {
    id: 7, oknesset_id: 'c1', name: 'ועדת החוקה', chair: '', lastSessionDate: '2026-10-01',
    lastSessionSummary: null, lastSessionDocumentUrl: null, sourceUrl: '', hasNewData: false,
    lastPolledAt: null,
  }

  it('the pattern catches raw palette classes', () => {
    for (const c of ['bg-white', 'text-blue-700', 'border-green-500', 'bg-orange-50', 'hover:bg-blue-50', 'border-slate-300']) {
      expect(c).toMatch(PALETTE_CLASS)
    }
    for (const c of ['bg-card', 'bg-success/10', 'border-warning', 'text-destructive', 'hover:bg-primary/5', 'border-border']) {
      expect(c).not.toMatch(PALETTE_CLASS)
    }
  })

  it('renders no palette class when empty', () => {
    const { container } = render(
      <MemoryRouter>
        <ParliamentStrip bills={[]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    expect(paletteClasses(container)).toEqual([])
  })

  it('renders no palette class for every bill status and a committee', () => {
    const statuses = ['בוועדה', 'הצבעה קרובה', 'סטטוס לא מוכר']
    const bills: Bill[] = statuses.map((status, i) => ({ ...BILL, id: i + 1, status }))
    const { container } = render(
      <MemoryRouter>
        <ParliamentStrip bills={bills} committees={[COMMITTEE]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('[class*="border-s-4"]')).toHaveLength(4)
    expect(paletteClasses(container)).toEqual([])
  })

  it('maps bill statuses to the status tokens', () => {
    const bills: Bill[] = [
      { ...BILL, id: 1, status: 'בוועדה' },
      { ...BILL, id: 2, status: 'הצבעה קרובה' },
    ]
    const { container } = render(
      <MemoryRouter>
        <ParliamentStrip bills={bills} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const cards = container.querySelectorAll('[class*="border-s-4"]')
    expect(cards[0].className).toContain('border-success')
    expect(cards[0].className).toContain('bg-success/10')
    expect(cards[1].className).toContain('border-warning')
    expect(cards[1].className).toContain('bg-warning/10')
  })
})
