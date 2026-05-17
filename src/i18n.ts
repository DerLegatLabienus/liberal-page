import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import he from './locales/he.json'
import en from './locales/en.json'

export function detectInitialLanguage(): string {
  const fromUrl = new URLSearchParams(location.search).get('lang')
  if (fromUrl === 'he' || fromUrl === 'en') {
    if (typeof localStorage !== 'undefined') localStorage.setItem('lang', fromUrl)
    return fromUrl
  }
  return (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) || 'he'
}

const lang = detectInitialLanguage()
document.documentElement.lang = lang
document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      he: { translation: he },
      en: { translation: en },
    },
    lng: lang,
    fallbackLng: 'he',
    interpolation: { escapeValue: false },
  })

export default i18n
