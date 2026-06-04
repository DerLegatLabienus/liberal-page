import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'

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
    api: { auth: { google: vi.fn(), refresh: vi.fn(), logout: vi.fn() } },
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
    <ToastProvider>
      <AuthProvider>
        <AuthControl />
      </AuthProvider>
    </ToastProvider>,
  )
}

describe('AuthControl sign-in toasts', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

  it('shows an error toast when sign-in is rejected (uninvited 403)', async () => {
    vi.mocked(api.auth.google).mockRejectedValue(Object.assign(new Error('not invited'), { status: 403 }))
    renderControl()
    await userEvent.click(await screen.findByText('google-signin'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent ?? '').toMatch(/invit|מורש/i) // "not invited" he/en
  })

  it('shows a success toast when sign-in succeeds', async () => {
    vi.mocked(api.auth.google).mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', user: { id: 1, email: 'a@x.com', name: 'A', role: 'member' },
    })
    renderControl()
    await userEvent.click(await screen.findByText('google-signin'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
