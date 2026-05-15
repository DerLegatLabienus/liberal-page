import galleryData from '@/data/gallery.json'
import type { GalleryItem } from '@/types'

const gallery = galleryData as GalleryItem[]

export default function GallerySection() {
  return (
    <section id="gallery" className="bg-white py-16">
      <div className="container mx-auto px-4">
        <h2 className="mb-6 text-2xl font-bold text-foreground">גלריה</h2>
        {gallery.length === 0 ? (
          <p className="text-muted-foreground">תמונות יתווספו בקרוב.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {gallery.map((item) => (
              <div key={item.id} className="group overflow-hidden rounded-lg border border-border">
                <div className="relative h-40 w-full bg-slate-100">
                  <img
                    src={item.src}
                    alt={item.caption}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </div>
                <div className="p-2">
                  <p className="text-xs text-muted-foreground">{item.caption}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
