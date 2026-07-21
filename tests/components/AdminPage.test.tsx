import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const useAuthMock = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return {
    ...actual,
    api: {
      admin: {
        listInvites: vi.fn().mockResolvedValue({ invites: [] }),
        addInvite: vi.fn().mockResolvedValue({}),
        removeInvite: vi.fn().mockResolvedValue({}),
        listUsers: vi.fn().mockResolvedValue({ users: [] }),
        setRole: vi.fn().mockResolvedValue({}),
        emailTemplates: { list: vi.fn().mockResolvedValue({ templates: [] }) },
        analytics: { joinSummary: vi.fn().mockResolvedValue({ lifetime: null, daily: [] }) },
        featureFlags: { update: vi.fn().mockResolvedValue({}) },
      },
      featureFlags: { get: vi.fn().mockResolvedValue({ lettersEnabled: { enabled: true, value: null } }) },
    },
  }
})

import { api } from '@/lib/api-client'
import { ToastProvider } from '@/contexts/ToastContext'
import AdminPage from '@/pages/AdminPage'

function renderPage() {
  render(<MemoryRouter><ToastProvider><AdminPage /></ToastProvider></MemoryRouter>)
}

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthMock.mockReturnValue({ user: { id: 1, role: 'admin' }, ready: true })
  })

  it('shows a loading skeleton while the session restores', () => {
    useAuthMock.mockReturnValue({ user: null, ready: false })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument() // skeleton, not "…Loading" text
  })

  it('denies a non-admin and offers a way home', () => {
    useAuthMock.mockReturnValue({ user: { id: 1, role: 'member' }, ready: true })
    renderPage()
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/')
  })

  it('renders the section tabs for an admin and defaults to Invites', async () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Invites' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Feature Flags' })).toBeInTheDocument()
    // Invites section fetched on mount
    expect(await screen.findByText(/No invites yet/)).toBeInTheDocument()
  })

  it('adds an invite (lowercased email)', async () => {
    renderPage()
    await userEvent.type(screen.getByPlaceholderText('Email to invite'), 'NEW@X.COM')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(api.admin.addInvite).toHaveBeenCalledWith('new@x.com', 'member')
  })

  it('switches to Feature Flags and saves', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Feature Flags' }))
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.admin.featureFlags.update).toHaveBeenCalledWith('lettersEnabled', { enabled: true, value: null })
  })
})
