import { useTranslation } from 'react-i18next'

/**
 * Understated privacy notice for the Civic Letters pages. Tells members that letter
 * sends are tallied anonymously / in aggregate only — the platform never links an
 * identity to a send (the analytics table stores only letterId + action, no user_id).
 */
export default function LetterPrivacyNotice({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <p className={`text-xs text-muted-foreground ${className}`.trim()}>
      <span className="font-medium">{t('letters.privacy_title')}: </span>
      {t('letters.privacy_body')}
    </p>
  )
}
