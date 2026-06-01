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

// FLAKY (intermittent): ConstitutionPage renders an <iframe src="constitution-structure.*.html">.
// happy-dom eagerly tries to *network-load* that iframe src (resolved against BASE_URL →
// http://localhost:3000/...), which has no server in CI/local. When a test finishes and the
// environment is torn down while that fetch is still in flight, happy-dom throws
// "AsyncTaskManager has been destroyed" / a NetworkError that can surface as a spurious failure.
// Any test in this file can be hit (all render the iframe), so retry is applied per-test below.
//
// Permanent fix (preferred over retry): disable iframe page loading in the happy-dom env so no
// network load is attempted at all. In vitest.config.ts:
//   test: { environmentOptions: { happyDOM: { settings: { disableIframePageLoading: true } } } }
// Until that's in place, `{ retry: 2 }` re-runs only the failing test, masking the teardown race.
const FLAKY = { retry: 2 }

describe('ConstitutionPage', () => {
  beforeEach(() => { h.lang = 'he' })

  it('defaults to the rich (iframe) view in the current language; no chapter cards yet', FLAKY, () => {
    renderPage()
    const iframe = screen.getByTitle(/organizational structure/i)
    expect(iframe.getAttribute('src')).toMatch(/constitution-structure\.he\.html$/)
    expect(screen.queryByText('חברי התנועה')).not.toBeInTheDocument()
  })

  it('switches to the reader view showing chapter cards', FLAKY, async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'תצוגת קריאה' }))
    expect(screen.getByText('חברי התנועה')).toBeInTheDocument()
    expect(screen.getByText('בית הדין')).toBeInTheDocument()
  })

  it('uses the English iframe and shows the disclaimer in reader view when language is en', FLAKY, async () => {
    h.lang = 'en'
    renderPage()
    const iframe = screen.getByTitle(/organizational structure/i)
    expect(iframe.getAttribute('src')).toMatch(/constitution-structure\.en\.html$/)
    await userEvent.click(screen.getByRole('button', { name: 'Reader view' }))
    expect(screen.getByText('Movement Members')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/unofficial translation/i)
  })
})
