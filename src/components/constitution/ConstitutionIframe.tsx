import { useEffect, useState } from 'react'

// Embeds the bespoke org-structure HTML (Hebrew or English) from public/, sized
// to its content via the height the page posts back (avoids nested scrollbars).
export default function ConstitutionIframe({ lang }: { lang: 'he' | 'en' }) {
  const [height, setHeight] = useState(0)
  const src = `${import.meta.env.BASE_URL}constitution-structure.${lang}.html`

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const data = e.data as { type?: string; height?: number }
      if (data?.type === 'constitution-height' && typeof data.height === 'number' && data.height > 0) {
        setHeight(data.height)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Reset height when the language (and thus the embedded document) changes.
  useEffect(() => { setHeight(0) }, [lang])

  return (
    <iframe
      key={lang}
      src={src}
      title="Likud constitution — organizational structure"
      className="w-full rounded-xl border border-border bg-white"
      style={{ height: height ? `${height}px` : '80vh' }}
    />
  )
}
