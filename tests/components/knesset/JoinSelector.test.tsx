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

describe('JoinSelector — design tokens only', () => {
  // Raw Tailwind palette classes, including variant-prefixed ones (hover:bg-blue-50, ring-blue-600/50 …).
  const PALETTE_CLASS = /^(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?$/

  function paletteClasses(container: HTMLElement): string[] {
    return [container, ...Array.from(container.querySelectorAll('*'))]
      .flatMap((el) => Array.from(el.classList))
      .filter((c) => PALETTE_CLASS.test(c))
  }

  it('the pattern catches raw palette classes', () => {
    for (const c of ['bg-white', 'text-white', 'text-slate-600', 'hover:bg-blue-50', 'focus-visible:ring-blue-500', 'border-slate-200']) {
      expect(c).toMatch(PALETTE_CLASS)
    }
    for (const c of ['bg-card', 'hover:bg-primary/5', 'border-border', 'text-muted-foreground', 'ring-ring']) {
      expect(c).not.toMatch(PALETTE_CLASS)
    }
  })

  it('renders no palette class before anything is selected', () => {
    const { container } = render(<JoinSelector />)
    expect(paletteClasses(container)).toEqual([])
  })

  it('renders no palette class once a status and mode are selected', async () => {
    const user = userEvent.setup()
    const { container } = render(<JoinSelector />)

    await user.click(screen.getByRole('button', { name: /אני כבר חבר/i }))
    await user.click(screen.getByRole('button', { name: 'זוגי' }))

    expect(screen.getByRole('link', { name: /פתחו את הטופס הרשמי/i })).toBeInTheDocument()
    expect(paletteClasses(container)).toEqual([])
  })
})
