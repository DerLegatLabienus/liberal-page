import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import ParliamentStrip from '@/components/sections/ParliamentStrip'

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
})
