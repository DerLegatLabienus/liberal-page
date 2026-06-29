import { useTranslation } from 'react-i18next'
import JoinSelector from '@/components/parliament/JoinSelector'

export default function JoinSection() {
  const { t } = useTranslation()

  return (
    <section id="join" className="bg-gradient-to-br from-blue-700 to-sky-600 py-12 text-center text-white">
      <div className="container mx-auto max-w-4xl px-4">
        <h2 className="mb-4 text-2xl font-bold">{t('join.heading')}</h2>
        <p className="mx-auto mb-8 max-w-xl text-base text-blue-100 leading-relaxed">
          {t('join.subtitle')}
        </p>
        <JoinSelector />
      </div>
    </section>
  )
}
