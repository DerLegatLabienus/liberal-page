import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: {
    admin: { letters: {
      beautify: vi.fn(),
      list: vi.fn().mockResolvedValue({ letters: [] }),
      contacts: { list: vi.fn().mockResolvedValue({ contacts: [] }) },
      letterTemplates: { list: vi.fn().mockResolvedValue({ templates: [] }) },
      media: { upload: vi.fn() },
    } },
    letters: { contacts: vi.fn().mockResolvedValue({ contacts: [] }) },
  },
  // errorStatus reads the `status` field off thrown Error objects, same shape as the real client.
  errorStatus: (e: unknown) => (e as { status?: number } | null)?.status,
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' }, ready: true }) }))
vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ lettersBeautifyEnabled: { enabled: true, value: null } }),
}))
vi.mock('@/hooks/useMkList', () => ({ useMkList: () => ({ mks: [], loading: false, error: null }) }))
// CodeMirror doesn't run under happy-dom; mock the editor to a plain textarea.
vi.mock('@/components/admin/HtmlCodeEditor', () => ({
  default: ({ value, onChange, placeholder, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import AdminLettersPage from '@/pages/AdminLettersPage'
import { MemoryRouter } from 'react-router-dom'
import { api } from '@/lib/api-client'

const failWith = (status: number) => Object.assign(new Error('x'), { status })

async function clickBeautify() {
  const user = userEvent.setup({ delay: null })
  render(<MemoryRouter><AdminLettersPage /></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: /New Letter/ }))
  await user.type(screen.getByPlaceholderText(/<p>/), '<p>גוף</p>')
  await user.click(screen.getByRole('button', { name: /Beautify/ }))
}

describe('admin composer beautify errors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says beautify is limited to once every 2 minutes on a 429', async () => {
    vi.mocked(api.admin.letters.beautify).mockRejectedValue(failWith(429))
    await clickBeautify()
    expect(await screen.findByText(/once every 2 minutes/)).toBeInTheDocument()
    expect(screen.queryByText(/AI service may be unavailable/)).not.toBeInTheDocument()
  })

  it('keeps the generic message for any other failure', async () => {
    vi.mocked(api.admin.letters.beautify).mockRejectedValue(failWith(503))
    await clickBeautify()
    expect(await screen.findByText(/AI service may be unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/once every 2 minutes/)).not.toBeInTheDocument()
  })
})
