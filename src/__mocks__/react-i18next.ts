import { vi } from 'vitest'
import he from '../locales/he.json'

function getNestedRaw(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return key
    }
  }
  return current
}

// Mirrors i18next's `returnObjects` option: with it set, arrays/objects are returned
// as-is (e.g. about.paragraphs); otherwise non-string values fall back to the key.
const useMock = ((k: string, opts?: { returnObjects?: boolean }) => {
  const value = getNestedRaw(he as Record<string, unknown>, k)
  if (opts?.returnObjects) return value
  return typeof value === 'string' ? value : k
}) as (k: string, opts?: object) => string

export const useTranslation = () => ({
  t: useMock,
  i18n: {
    language: 'he',
    changeLanguage: vi.fn(),
  },
})

export const Trans = ({ i18nKey }: { i18nKey: string }) => i18nKey
export const initReactI18next = { type: '3rdParty', init: vi.fn() }
