import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Header from '@/components/layout/Header'

describe('Header — language toggle URL sync', () => {
  beforeEach(() => {
    vi.spyOn(history, 'replaceState')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls history.replaceState with ?lang=en when toggling from Hebrew', async () => {
    const user = userEvent.setup()
    render(<Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={true} />)
    await user.click(screen.getByRole('button', { name: /EN/i }))
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '?lang=en')
  })
})

describe('Header — trackerEnabled prop', () => {
  it('tracker button is enabled when trackerEnabled=true', () => {
    render(<Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={true} />)
    const btn = screen.getAllByRole('button').find(b => b.textContent?.includes('מעקב כנסת'))
    expect(btn).not.toBeDisabled()
  })

  it('tracker button is disabled when trackerEnabled=false', () => {
    render(<Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />)
    const btn = screen.getAllByRole('button').find(b => b.textContent?.includes('מעקב כנסת'))
    expect(btn).toBeDisabled()
  })

  it('disabled tracker button has tooltip text', () => {
    render(<Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />)
    const btn = screen.getAllByRole('button').find(b => b.textContent?.includes('מעקב כנסת'))
    expect(btn).toHaveAttribute('title', 'Available in Hebrew')
  })
})
