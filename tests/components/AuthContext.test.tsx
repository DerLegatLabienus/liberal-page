import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { auth: { google: vi.fn(), refresh: vi.fn(), logout: vi.fn() } },
  setAccessToken: vi.fn(),
  setRefreshHandler: vi.fn(),
}))

import { api } from '@/lib/api-client'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'

const REFRESH_KEY = 'liberal.refreshToken'
const RESP = { accessToken: 'acc', refreshToken: 'ref', user: { id: 1, email: 'a@x.com', name: 'A', role: 'member' } }

function Harness() {
  const { user, ready, signIn, signOut } = useAuth()
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="user">{user ? user.email : 'none'}</span>
      <button onClick={() => void signIn('idtok')}>signin</button>
      <button onClick={() => void signOut()}>signout</button>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

  it('starts anonymous when there is no stored refresh token', async () => {
    render(<AuthProvider><Harness /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    expect(screen.getByTestId('user').textContent).toBe('none')
    expect(api.auth.refresh).not.toHaveBeenCalled()
  })

  it('signs in via Google and stores the refresh token', async () => {
    vi.mocked(api.auth.google).mockResolvedValue(RESP)
    render(<AuthProvider><Harness /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))

    await userEvent.click(screen.getByText('signin'))
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('a@x.com'))
    expect(api.auth.google).toHaveBeenCalledWith('idtok')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('ref')
  })

  it('restores a session on mount when a refresh token exists', async () => {
    localStorage.setItem(REFRESH_KEY, 'stored-ref')
    vi.mocked(api.auth.refresh).mockResolvedValue(RESP)
    render(<AuthProvider><Harness /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('a@x.com'))
    expect(api.auth.refresh).toHaveBeenCalledWith('stored-ref')
  })

  it('propagates a sign-in failure so the caller can surface it (e.g. uninvited 403)', async () => {
    const err = Object.assign(new Error('This email is not invited'), { status: 403 })
    vi.mocked(api.auth.google).mockRejectedValue(err)
    let caught: unknown
    function Catcher() {
      const { signIn } = useAuth()
      return <button onClick={() => signIn('idtok').catch((e) => { caught = e })}>x</button>
    }
    render(<AuthProvider><Catcher /></AuthProvider>)
    await userEvent.click(screen.getByText('x'))
    await waitFor(() => expect(caught).toBe(err))
    expect((caught as { status?: number }).status).toBe(403)
  })

  it('signs out, clearing the user and stored token', async () => {
    vi.mocked(api.auth.google).mockResolvedValue(RESP)
    vi.mocked(api.auth.logout).mockResolvedValue({ ok: true })
    render(<AuthProvider><Harness /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    await userEvent.click(screen.getByText('signin'))
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('a@x.com'))

    await userEvent.click(screen.getByText('signout'))
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'))
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
    expect(api.auth.logout).toHaveBeenCalledWith('ref')
  })
})
