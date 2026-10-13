import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BillCard from '@/components/parliament/BillCard'
import type { Bill } from '@/types'

function billFixture(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 7,
    oknesset_id: '2200001',
    number: 'פ/1234/25',
    title: 'הצעת חוק לדוגמה',
    status: 'עבר',
    position: 'עוקבים',
    notes: 'סיכום קצר של הצעת החוק',
    committee: 'ועדת החוקה',
    sourceUrl: 'https://main.knesset.gov.il/bill/1234',
    documentUrl: null,
    hasNewData: false,
    lastPolledAt: '2026-10-01T10:00:00Z',
    ...overrides,
  }
}

// Tailwind default-palette colour utilities (bg-slate-100, text-red-600, bg-white, …).
// The design system allows token utilities only.
const PALETTE_CLASS =
  /^(?:[a-z]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?$/

function paletteClasses(root: HTMLElement): string[] {
  const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  return all.flatMap(el => Array.from(el.classList)).filter(c => PALETTE_CLASS.test(c))
}

describe('BillCard', () => {
  it('renders title, number, committee, notes and remove action', () => {
    const onRemove = vi.fn()
    render(<BillCard bill={billFixture()} onRemove={onRemove} />)
    expect(screen.getByText('הצעת חוק לדוגמה')).toBeInTheDocument()
    expect(screen.getByText(/פ\/1234\/25/)).toBeInTheDocument()
    expect(screen.getByText('סיכום קצר של הצעת החוק')).toBeInTheDocument()
    screen.getByRole('button', { name: 'הסר' }).click()
    expect(onRemove).toHaveBeenCalledWith(7)
  })

  it.each(['עבר', 'נדחה', 'סטטוס לא מוכר'])(
    'uses token utilities only for status %s (with notes, source link and remove button)',
    (status) => {
      const { container } = render(<BillCard bill={billFixture({ status })} onRemove={() => {}} />)
      expect(paletteClasses(container)).toEqual([])
    },
  )

  it('uses token utilities only without notes or remove button', () => {
    const { container } = render(<BillCard bill={billFixture({ notes: '', lastPolledAt: null })} />)
    expect(paletteClasses(container)).toEqual([])
  })

  // Status colours come from the success and warning tokens (added 2026-10-14).
  it.each([
    ['בוועדה', 'success'],
    ['הצבעה קרובה', 'warning'],
  ])('status %s uses the %s token and no palette class', (status, token) => {
    const { container } = render(<BillCard bill={billFixture({ status })} onRemove={() => {}} />)
    expect(paletteClasses(container)).toEqual([])
    expect(container.innerHTML).toContain(`bg-${token}/10`)
    expect(container.innerHTML).toContain(`text-${token}`)
  })
})
