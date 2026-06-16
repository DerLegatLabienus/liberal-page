import { describe, it, expect, vi } from 'vitest'
import { IMAGE_FALLBACK, onImageError } from '@/lib/image-fallback'

describe('image-fallback', () => {
  it('IMAGE_FALLBACK is an inline SVG data URI', () => {
    expect(IMAGE_FALLBACK.startsWith('data:image/svg+xml,')).toBe(true)
  })

  it('onImageError swaps the src to the fallback and clears the handler (no loop)', () => {
    const img = { src: 'https://broken/x.png', onerror: vi.fn() } as unknown as HTMLImageElement
    onImageError({ currentTarget: img } as unknown as React.SyntheticEvent<HTMLImageElement>)
    expect(img.src).toBe(IMAGE_FALLBACK)
    expect(img.onerror).toBeNull()
  })
})
