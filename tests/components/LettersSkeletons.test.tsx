import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import LettersListSkeleton from '@/components/letters/LettersListSkeleton'
import { TableSkeleton } from '@/components/ui/table-skeleton'

// A skeleton block is a decorative div (aria-hidden) with the pulse class.
const skeletons = (root: HTMLElement) => root.querySelectorAll('[data-slot="skeleton"]')

describe('structural skeletons', () => {
  it('LettersListSkeleton mirrors the card list with a status role and N cards', () => {
    const { container } = render(<LettersListSkeleton count={3} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    // each card has 4 skeleton blocks (title, meta, 2 tag chips) → 3 cards = 12
    expect(skeletons(container)).toHaveLength(12)
  })

  it('TableSkeleton renders a header + rows×cols cells with a status role', () => {
    const { container } = render(<TableSkeleton rows={4} cols={6} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    // (header + 4 rows) × 6 cols = 30 cells
    expect(skeletons(container)).toHaveLength(30)
  })

  it('TableSkeleton can omit the header', () => {
    const { container } = render(<TableSkeleton rows={2} cols={2} header={false} />)
    expect(skeletons(container)).toHaveLength(4) // 2 rows × 2 cols, no header
  })
})
