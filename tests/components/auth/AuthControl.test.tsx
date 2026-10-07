import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Mock the Google button: render a plain button that fires onSuccess with a credential.
vi.mock('@react-oauth/google', () => ({
  GoogleLogin: (props: { onSuccess: (c: { credential: string }) => void }) => (
    <button onClick={() => props.onSuccess({ credential: 'idtok' })}>google-signin</button>
  ),
}))

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return {
    ...actual,
    api: { auth: { google: vi.fn(), refresh: vi.fn(), logout: vi.fn(), updateMe: vi.fn() } },
    setAccessToken: vi.fn(),
    setRefreshHandler: vi.fn(),
  }
})

import { api } from '@/lib/api-client'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import AuthControl from '@/components/layout/AuthControl'

function renderControl() {
  return render(
    // Signing in mounts UserMenu, whose admin item uses useNavigate — needs a Router.
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <AuthControl />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('AuthControl sign-in toasts', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

  // The logged-out control is now a single "Sign in" button that opens a modal holding the
  // Google button + email link options — open it first, then interact.
  const openLoginModal = async () => {
    await userEvent.click(await screen.findByRole('button', { name: /sign in|התחבר/i }))
    return screen.findByText('google-signin')
  }

  // Design system: the shared Button is the only button, and a primary action takes its
  // colour from the brand token, never a hardcoded palette colour.
  it('renders the email-link submit as the shared primary Button', async () => {
    renderControl()
    await openLoginModal()
    const submit = screen.getByRole('button', { name: /magic_link_button|קישור|email link/i })
    expect(submit).toHaveAttribute('data-slot', 'button')
    expect(submit).toHaveAttribute('type', 'submit')
    expect(submit.className).toMatch(/\bbg-primary\b/)
    expect(submit.className).not.toMatch(/blue-\d/)
  })

  // Design system: the dialog uses token utilities only — no hardcoded palette classes on any
  // element, including the error message and the email field (LibPage-021).
  const PALETTE = /(^|\s|:)(bg-white|[a-z-]*(slate|red|blue|amber)-\d)/
  const paletteClasses = (root: Element) =>
    [root, ...root.querySelectorAll('*')]
      .map((el) => el.getAttribute('class') ?? '')
      .filter((cls) => PALETTE.test(cls))

  it('uses no hardcoded palette classes in the sign-in dialog', async () => {
    vi.mocked(api.auth.google).mockRejectedValue(Object.assign(new Error('not invited'), { status: 403 }))
    renderControl()
    await userEvent.click(await openLoginModal())
    const alert = await screen.findByRole('alert') // error message rendered too
    expect(alert.className).toMatch(/\btext-destructive\b/)
    const dialog = screen.getByRole('dialog')
    // The dev-only sign-in buttons render under vitest (import.meta.env.DEV), so they are covered.
    expect(within(dialog).getAllByRole('button', { name: /Dev Sign In/ })).toHaveLength(2)
    expect(paletteClasses(dialog)).toEqual([])
  })

  it('renders the email field as the shared Input', async () => {
    renderControl()
    await openLoginModal()
    const email = screen.getByRole('dialog').querySelector('input[type="email"]')
    expect(email).not.toBeNull()
    expect(email).toHaveAttribute('data-slot', 'input')
  })

  it('shows an error toast when sign-in is rejected (uninvited 403)', async () => {
    vi.mocked(api.auth.google).mockRejectedValue(Object.assign(new Error('not invited'), { status: 403 }))
    renderControl()
    await userEvent.click(await openLoginModal())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent ?? '').toMatch(/invit|מורש/i) // "not invited" he/en
  })

  it('shows a success toast when sign-in succeeds', async () => {
    vi.mocked(api.auth.google).mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', user: { id: 1, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: true },
    })
    renderControl()
    await userEvent.click(await openLoginModal())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('toggles email alerts via api.auth.updateMe when signed in', async () => {
    vi.mocked(api.auth.updateMe).mockResolvedValue({
      user: { id: 1, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: false },
    })
    vi.mocked(api.auth.google).mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', user: { id: 1, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: true },
    })
    renderControl()
    await userEvent.click(await openLoginModal())
    // Email alerts now live inside the account dropdown — open it, then toggle.
    await userEvent.click(await screen.findByRole('button', { name: /תפריט משתמש|account menu/i }))
    const checkbox = await screen.findByRole('checkbox', { name: /alerts|התראות/i })
    await userEvent.click(checkbox)
    expect(api.auth.updateMe).toHaveBeenCalledWith({ emailAlerts: false })
  })
})
