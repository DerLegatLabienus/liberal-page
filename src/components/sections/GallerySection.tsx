import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { useDirection } from '@/hooks/useDirection'
import { onImageError } from '@/lib/image-fallback'
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog'
import galleryData from '@/data/gallery.json'
import type { GalleryItem } from '@/types'

const gallery = galleryData as GalleryItem[]

function resolveImageSrc(src: string): string {
  return src.startsWith('/') ? `${import.meta.env.BASE_URL}${src.slice(1)}` : src
}

export default function GallerySection() {
  const { t, i18n } = useTranslation()
  const direction = useDirection()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const selected = selectedIndex !== null ? gallery[selectedIndex] : null
  const caption = selected
    ? (i18n.language === 'he' ? selected.caption : (selected.captionEn ?? selected.caption))
    : ''

  function prev() {
    setSelectedIndex(i => i !== null ? (i - 1 + gallery.length) % gallery.length : null)
  }
  function next() {
    setSelectedIndex(i => i !== null ? (i + 1) % gallery.length : null)
  }

  return (
    <div dir={direction}>
        <h2 className="mb-8 text-start text-2xl font-bold text-foreground">
          {t('gallery.heading')}
        </h2>
        {gallery.length === 0 ? (
          <p className="text-start text-muted-foreground">{t('gallery.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {gallery.map((item, i) => (
              <div
                key={item.id}
                className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-white shadow-sm"
                onClick={() => setSelectedIndex(i)}
              >
                <div className="relative h-44 w-full bg-slate-100">
                  <img
                    src={resolveImageSrc(item.src)}
                    alt={i18n.language === 'he' ? item.caption : (item.captionEn ?? item.caption)}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={onImageError}
                  />
                </div>
                <div className="px-3 py-2">
                  <p className="text-start text-xs text-muted-foreground leading-snug">
                    {i18n.language === 'he' ? item.caption : (item.captionEn ?? item.caption)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

      <Dialog open={selectedIndex !== null} onOpenChange={(open) => { if (!open) setSelectedIndex(null) }}>
        <DialogContent>
          <div className="relative rounded-xl bg-black/95 p-2 shadow-2xl">
            <DialogClose className="absolute end-3 top-3 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
              <XIcon className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DialogClose>

            {selected && (
              <img
                src={resolveImageSrc(selected.srcFull ?? selected.src)}
                alt={caption}
                className="mx-auto max-h-[80vh] w-full rounded-lg object-contain"
              />
            )}

            <div className="flex items-center justify-between px-2 pt-2">
              <button
                onClick={prev}
                className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                aria-label="Previous"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              {caption && (
                <p className="flex-1 px-4 text-center text-sm text-white/80">{caption}</p>
              )}
              <button
                onClick={next}
                className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                aria-label="Next"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
