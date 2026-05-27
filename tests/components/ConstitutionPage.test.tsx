import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ lang: 'he' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: h.lang, changeLanguage: vi.fn() },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))
vi.mock('@/hooks/useDirection', () => ({ useDirection: () => (h.lang === 'he' ? 'rtl' : 'ltr') }))

import ConstitutionPage from '@/pages/ConstitutionPage'

function renderPage() {
  return render(<MemoryRouter><ConstitutionPage /></MemoryRouter>)
}

describe('ConstitutionPage', () => {
  beforeEach(() => { h.lang = 'he' })

  it('renders Hebrew chapter titles by default, no disclaimer', () => {
    renderPage()
    expect(screen.getByText('חברי התנועה')).toBeInTheDocument()
    expect(screen.getByText('בית הדין')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('renders English titles + disclaimer when language is en', () => {
    h.lang = 'en'
    renderPage()
    expect(screen.getByText('Movement Members')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/unofficial translation/i)
  })
})
