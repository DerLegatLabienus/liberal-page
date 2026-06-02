import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach } from 'vitest'
import JoinSelector, { EFFECTIVE_SOFT_URLS } from '@/components/parliament/JoinSelector'
import { api } from '@/lib/api-client'

vi.mock('@/lib/api-client', () => ({
  api: { analytics: { joinClick: vi.fn().mockResolvedValue({ ok: true }) } },
}))

describe('JoinSelector', () => {
  beforeEach(() => { vi.mocked(api.analytics.joinClick).mockClear() })

  it('keeps the official form CTA disabled until a status and mode are selected', () => {
    render(<JoinSelector />)

    expect(screen.getByRole('button', { name: /פתחו את הטופס הרשמי/i })).toBeDisabled()
  })

  it('routes existing Likud couple joins to the no-credit-card couple form', async () => {
    const user = userEvent.setup()
    render(<JoinSelector />)

    await user.click(screen.getByRole('button', { name: /אני כבר חבר/i }))
    await user.click(screen.getByRole('button', { name: 'זוגי' }))

    const cta = screen.getByRole('link', { name: /פתחו את הטופס הרשמי/i })
    expect(cta).toHaveAttribute('href', EFFECTIVE_SOFT_URLS.existing.couple)
  })

  it('routes renewal individual joins to the standard individual form', async () => {
    const user = userEvent.setup()
    render(<JoinSelector />)

    await user.click(screen.getByRole('button', { name: /חידוש/i }))
    await user.click(screen.getByRole('button', { name: 'יחיד' }))

    const cta = screen.getByRole('link', { name: /פתחו את הטופס הרשמי/i })
    expect(cta).toHaveAttribute('href', EFFECTIVE_SOFT_URLS.renewal.individual)
  })

  it('fires a click-through analytics event with the selected status and mode', async () => {
    const user = userEvent.setup()
    render(<JoinSelector />)

    await user.click(screen.getByRole('button', { name: /אני כבר חבר/i }))
    await user.click(screen.getByRole('button', { name: 'זוגי' }))
    await user.click(screen.getByRole('link', { name: /פתחו את הטופס הרשמי/i }))

    expect(api.analytics.joinClick).toHaveBeenCalledWith('existing', 'couple')
  })
})
