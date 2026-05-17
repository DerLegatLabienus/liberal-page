import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import he from './locales/he.json'
import en from './locales/en.json'

const savedLang = (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) || 'he'
document.documentElement.lang = savedLang
document.documentElement.dir = savedLang === 'he' ? 'rtl' : 'ltr'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      he: { translation: he },
      en: { translation: en },
    },
    lng: savedLang,
    fallbackLng: 'he',
    interpolation: { escapeValue: false },
  })

export default i18n
