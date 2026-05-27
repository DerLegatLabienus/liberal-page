import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import TranslationDisclaimer from '@/components/constitution/TranslationDisclaimer'

describe('TranslationDisclaimer', () => {
  it('renders the unofficial-translation warning text', () => {
    render(<TranslationDisclaimer />)
    expect(screen.getByRole('note')).toHaveTextContent(/unofficial translation/i)
    expect(screen.getByRole('note')).toHaveTextContent(/Hebrew/i)
  })
})
