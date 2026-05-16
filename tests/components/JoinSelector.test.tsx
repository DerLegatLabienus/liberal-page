import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import JoinSelector, { EFFECTIVE_SOFT_URLS } from '@/components/parliament/JoinSelector'

describe('JoinSelector', () => {
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
})
