import { render, screen, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ConstitutionIframe from '@/components/constitution/ConstitutionIframe'

describe('ConstitutionIframe', () => {
  it('builds the iframe src for the given language', () => {
    const { rerender } = render(<ConstitutionIframe lang="he" />)
    expect(screen.getByTitle(/organizational structure/i).getAttribute('src')).toMatch(/he\.html$/)
    rerender(<ConstitutionIframe lang="en" />)
    expect(screen.getByTitle(/organizational structure/i).getAttribute('src')).toMatch(/en\.html$/)
  })

  it('sizes to the height posted by the embedded page', () => {
    render(<ConstitutionIframe lang="he" />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'constitution-height', height: 1234 },
          origin: window.location.origin,
        }),
      )
    })
    expect(screen.getByTitle(/organizational structure/i)).toHaveStyle({ height: '1234px' })
  })
})
