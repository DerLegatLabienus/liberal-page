import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect } from 'vitest'

// KnessetBillsOverview fetches via the api client; stub it so the composed
// section renders without network.
vi.mock('@/lib/api-client', () => ({
  api: {
    bills: {
      recent: vi.fn().mockResolvedValue([]),
      trending: vi.fn().mockResolvedValue([]),
      policyAligned: vi.fn().mockResolvedValue([]),
    },
    featureFlags: { get: vi.fn().mockResolvedValue({}) },
  },
}))

import KnessetSection from '@/components/sections/KnessetSection'

describe('KnessetSection', () => {
  it('renders the tracked strip and the bills overview inside one section', async () => {
    const { container } = render(
      <MemoryRouter>
        <KnessetSection bills={[]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('section')).toHaveLength(1)
    // Strip teaser heading + overview heading both present in the one section.
    expect(screen.getByText('📊 במעקב שלנו')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('מה קורה בכנסת')).toBeInTheDocument())
  })

  it('shows an error banner with a retry action when error is set', () => {
    const onRetry = vi.fn()
    render(
      <MemoryRouter>
        <KnessetSection bills={[]} committees={[]} onOpenDrawer={vi.fn()} error onRetry={onRetry} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/שגיאה בטעינת נתוני הכנסת/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /נסה שוב/ })).toBeInTheDocument()
  })
})
