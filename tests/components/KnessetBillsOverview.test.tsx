import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Hoisted so the (hoisted) vi.mock factory below can reference them.
const { ITEM, POLICY } = vi.hoisted(() => {
  const ITEM = { billId: 1, title: 'הצעת חוק א', statusId: 101, status: 'הכנה', committee: '', lastUpdatedDate: '', summary: '', knessetUrl: 'http://k/1' }
  const POLICY = { ...ITEM, billId: 2, title: 'הצעת חוק ליברלית' }
  return { ITEM, POLICY }
})

vi.mock('@/lib/api-client', () => ({
  api: {
    bills: {
      recent: vi.fn().mockResolvedValue([ITEM]),
      trending: vi.fn().mockResolvedValue([{ ...ITEM, billId: 3, title: 'בולטת', reason: 'r' }]),
      policyAligned: vi.fn().mockResolvedValue([POLICY]),
    },
    featureFlags: { get: vi.fn().mockResolvedValue({ policyFilter: { enabled: true, value: null } }) },
  },
}))

import KnessetBillsOverview from '@/components/sections/KnessetBillsOverview'

describe('KnessetBillsOverview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the recent tab by default', async () => {
    render(<KnessetBillsOverview />)
    await waitFor(() => expect(screen.getByText('הצעת חוק א')).toBeInTheDocument())
  })

  it('switches to the policy tab on click', async () => {
    render(<KnessetBillsOverview />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'ליברליות' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: 'ליברליות' }))
    await waitFor(() => expect(screen.getByText('הצעת חוק ליברלית')).toBeInTheDocument())
  })
})
