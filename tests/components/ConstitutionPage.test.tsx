import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const renderPage = () => render(<MemoryRouter><ConstitutionPage /></MemoryRouter>)

// Note: this page renders an <iframe src="constitution-structure.*.html">. happy-dom's
// iframe page-loading is disabled in vitest.config.ts (`disableIframePageLoading`), which
// prevents the network-load teardown race that previously made these tests intermittently fail.

describe('ConstitutionPage', () => {
  beforeEach(() => { h.lang = 'he' })

  it('defaults to the rich (iframe) view in the current language; no chapter cards yet', () => {
    renderPage()
    const iframe = screen.getByTitle(/organizational structure/i)
    expect(iframe.getAttribute('src')).toMatch(/constitution-structure\.he\.html$/)
    expect(screen.queryByText('חברי התנועה')).not.toBeInTheDocument()
  })

  it('switches to the reader view showing chapter cards', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'תצוגת קריאה' }))
    expect(screen.getByText('חברי התנועה')).toBeInTheDocument()
    expect(screen.getByText('בית הדין')).toBeInTheDocument()
  })

  it('uses the English iframe and shows the disclaimer in reader view when language is en', async () => {
    h.lang = 'en'
    renderPage()
    const iframe = screen.getByTitle(/organizational structure/i)
    expect(iframe.getAttribute('src')).toMatch(/constitution-structure\.en\.html$/)
    await userEvent.click(screen.getByRole('button', { name: 'Reader view' }))
    expect(screen.getByText('Movement Members')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/unofficial translation/i)
  })
})
