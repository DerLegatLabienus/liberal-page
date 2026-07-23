// tests/components/MediaPanel.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { list, upload, del } = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn(), del: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ api: { admin: { letters: { media: { list, upload, delete: del } } } } }))

import MediaPanel from '@/components/letters/MediaPanel'

const asset = { id: 1, key: 'letters/a.png', url: 'https://pub-x.r2.dev/letters/a.png', filename: 'a.png', contentType: 'image/png', sizeBytes: 10, uploadedBy: null, createdAt: '2026-07-01T00:00:00Z' }

describe('MediaPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    list.mockResolvedValue({ assets: [asset] })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  it('lists existing assets', async () => {
    render(<MediaPanel />)
    expect(await screen.findByText('a.png')).toBeInTheDocument()
  })

  it('copies an <img> snippet for an asset', async () => {
    render(<MediaPanel />)
    await screen.findByText('a.png')
    await userEvent.click(screen.getByRole('button', { name: /snippet/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '<img src="https://pub-x.r2.dev/letters/a.png" alt="" style="max-width:100%" />'
    )
  })

  it('uploads a file and shows the new asset', async () => {
    const created = { ...asset, id: 2, filename: 'b.png', url: 'https://pub-x.r2.dev/letters/b.png' }
    upload.mockResolvedValue({ asset: created })
    render(<MediaPanel />)
    await screen.findByText('a.png')
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'b.png', { type: 'image/png' })
    await userEvent.upload(screen.getByTestId('media-file-input'), file)
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file))
    expect(await screen.findByText('b.png')).toBeInTheDocument()
  })
})
