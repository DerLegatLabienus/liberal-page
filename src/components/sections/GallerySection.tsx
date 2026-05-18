import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import galleryData from '@/data/gallery.json'
import type { GalleryItem } from '@/types'

const gallery = galleryData as GalleryItem[]

export default function GallerySection() {
  const { t } = useTranslation()
  const direction = useDirection()

  return (
    <section id="gallery" className="bg-slate-50 py-16" dir={direction}>
      <div className="container mx-auto max-w-4xl px-4">
        <h2 className="mb-8 text-start text-2xl font-bold text-foreground">
          {t('gallery.heading')}
        </h2>
        {gallery.length === 0 ? (
          <p className="text-start text-muted-foreground">{t('gallery.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {gallery.map((item) => (
              <div key={item.id} className="group overflow-hidden rounded-xl border border-border bg-white shadow-sm">
                <div className="relative h-44 w-full bg-slate-100">
                  <img
                    src={item.src}
                    alt={item.caption}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                </div>
                <div className="px-3 py-2">
                  <p className="text-start text-xs text-muted-foreground leading-snug">{item.caption}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
