import { useCallback, useEffect, useRef, useState } from 'react'
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

interface GallerySectionProps {
  /** Cap the number of thumbnails in the grid (keeps the carousel panel short on
   *  mobile). The lightbox still cycles through every image. */
  maxItems?: number
}

export default function GallerySection({ maxItems }: GallerySectionProps = {}) {
  const { t, i18n } = useTranslation()
  const direction = useDirection()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const shown = maxItems != null ? gallery.slice(0, maxItems) : gallery

  const selected = selectedIndex !== null ? gallery[selectedIndex] : null
  const caption = selected
    ? (i18n.language === 'he' ? selected.caption : (selected.captionEn ?? selected.caption))
    : ''

  const step = useCallback((delta: number) => {
    setSelectedIndex((i) => (i === null ? null : Math.max(0, Math.min(i + delta, gallery.length - 1))))
  }, [])

  // Keyboard nav while the lightbox is open (RTL: Left = forward, Right = back).
  useEffect(() => {
    if (selectedIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(direction === 'rtl' ? 1 : -1)
      else if (e.key === 'ArrowRight') step(direction === 'rtl' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIndex, direction, step])

  // Keep the active thumbnail in view as the selection changes.
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedIndex === null) return
    const thumb = stripRef.current?.children[selectedIndex] as HTMLElement | undefined
    thumb?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [selectedIndex])

  // Arrows point outward to their edge; in RTL "forward" (next) is to the left.
  const PrevIcon = direction === 'rtl' ? ChevronRightIcon : ChevronLeftIcon
  const NextIcon = direction === 'rtl' ? ChevronLeftIcon : ChevronRightIcon

  return (
    <div dir={direction}>
        <h2 className="mb-8 text-start text-2xl font-bold text-foreground">
          {t('gallery.heading')}
        </h2>
        {gallery.length === 0 ? (
          <p className="text-start text-muted-foreground">{t('gallery.empty')}</p>
        ) : (
          <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {shown.map((item, i) => (
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
          {shown.length < gallery.length && (
            <div className="mt-4 text-center">
              <button
                type="button"
                data-testid="gallery-view-all"
                onClick={() => setSelectedIndex(0)}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t('gallery.view_all', { count: gallery.length })}
              </button>
            </div>
          )}
          </>
        )}

      <Dialog open={selectedIndex !== null} onOpenChange={(open) => { if (!open) setSelectedIndex(null) }}>
        <DialogContent>
          <div dir={direction} className="relative rounded-xl bg-black/95 p-2 shadow-2xl">
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

            {/* Big edge arrows, easy to hit. Disabled at the ends (no wrap). */}
            <button
              onClick={() => step(-1)}
              disabled={selectedIndex === 0}
              className="absolute start-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white transition hover:bg-black/80 disabled:opacity-30"
              aria-label="Previous"
            >
              <PrevIcon className="h-6 w-6" />
            </button>
            <button
              onClick={() => step(1)}
              disabled={selectedIndex === gallery.length - 1}
              className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white transition hover:bg-black/80 disabled:opacity-30"
              aria-label="Next"
            >
              <NextIcon className="h-6 w-6" />
            </button>

            <div className="flex items-center justify-center gap-3 px-2 pt-3 pb-1">
              {caption && <p className="text-center text-sm text-white/80">{caption}</p>}
              <span dir="ltr" className="shrink-0 text-xs font-medium text-white/60">
                {(selectedIndex ?? 0) + 1} / {gallery.length}
              </span>
            </div>

            {/* Thumbnail filmstrip — jump straight to any photo. */}
            {gallery.length > 1 && (
              <div
                ref={stripRef}
                className="mt-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {gallery.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid="lightbox-thumb"
                    aria-current={i === selectedIndex}
                    aria-label={`תמונה ${i + 1}`}
                    onClick={() => setSelectedIndex(i)}
                    className={`h-12 w-16 shrink-0 overflow-hidden rounded ring-2 transition ${
                      i === selectedIndex ? 'ring-white' : 'opacity-50 ring-transparent hover:opacity-100'
                    }`}
                  >
                    <img
                      src={resolveImageSrc(item.src)}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={onImageError}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
