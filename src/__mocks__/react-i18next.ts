import { vi } from 'vitest'

const useMock = ((k: string) => k) as (k: string, opts?: object) => string

export const useTranslation = () => ({
  t: useMock,
  i18n: {
    language: 'he',
    changeLanguage: vi.fn(),
  },
})

export const Trans = ({ i18nKey }: { i18nKey: string }) => i18nKey
export const initReactI18next = { type: '3rdParty', init: vi.fn() }
