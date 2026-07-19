import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Copies a letter's public share-page URL to the clipboard, with a brief "copied"
 * confirmation. Rendered only when a share page actually exists (the caller checks
 * `letter.shareUrl` for null), so this component always receives a real URL.
 */
export default function CopyShareLink({ url, className }: { url: string; className?: string }) {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
        } catch {
          // Clipboard can be blocked (insecure context / denied permission) — the title
          // attribute still exposes the URL for manual copying, so fail quietly.
        }
        setDone(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setDone(false), 1500)
      }}
      className={className ?? 'text-xs font-medium text-muted-foreground hover:text-primary'}
      title={url}
    >
      {done ? t('letters.copied') : t('letters.copy_share_link')}
    </button>
  )
}
