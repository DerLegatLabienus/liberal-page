import { vi } from 'vitest'
import he from '../locales/he.json'

function getNestedValue(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return key
    }
  }
  return typeof current === 'string' ? current : key
}

const useMock = ((k: string) => getNestedValue(he as Record<string, unknown>, k)) as (k: string, opts?: object) => string

export const useTranslation = () => ({
  t: useMock,
  i18n: {
    language: 'he',
    changeLanguage: vi.fn(),
  },
})

export const Trans = ({ i18nKey }: { i18nKey: string }) => i18nKey
export const initReactI18next = { type: '3rdParty', init: vi.fn() }
