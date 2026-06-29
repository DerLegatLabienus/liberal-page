import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useDirection } from '@/hooks/useDirection'
import { useMkList } from '@/hooks/useMkList'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { useAuthOptional } from '@/contexts/AuthContext'
import AboutSection from '@/components/sections/AboutSection'
import LiberalsShowcase from '@/components/sections/LiberalsShowcase'
import FaqSection from '@/components/sections/FaqSection'
import MeetUsSection from '@/components/sections/MeetUsSection'
import GallerySection from '@/components/sections/GallerySection'

const AUTO_ADVANCE_MS = 6000

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * The identity cluster as a horizontally-snapping carousel: Who we are · Our MKs ·
 * FAQ · Meet us, one full-width panel each. The MK and Meet-us panels are included
 * only when their data is present, so the dots/arrows track the visible panels.
 * Keeps the `#about` anchor the header nav points at.
 */
export default function HomePanels() {
  const direction = useDirection()
  const { mks } = useMkList()
  const flags = useFeatureFlags()
  const auth = useAuthOptional()

  const hasLiberalMks = mks.some((m) => m.isLiberal || m.isSupporter)
  const showMeetUs = (flags['meetUs']?.enabled ?? false) && !auth?.user

  const panels: { id: string; node: React.ReactNode }[] = [
    { id: 'about', node: <AboutSection /> },
    ...(hasLiberalMks ? [{ id: 'mks', node: <LiberalsShowcase /> }] : []),
    { id: 'faq', node: <FaqSection /> },
    ...(showMeetUs ? [{ id: 'meetus', node: <MeetUsSection /> }] : []),
    { id: 'gallery', node: <GallerySection /> },
  ]

  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(i, panels.length - 1))
    const panel = trackRef.current?.children[clamped] as HTMLElement | undefined
    panel?.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    setActive(clamped)
  }, [panels.length])

  // Direction-robust: pick the panel whose centre is closest to the track centre.
  const handleScroll = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const trackRect = track.getBoundingClientRect()
    const centre = trackRect.left + trackRect.width / 2
    let nearest = 0
    let best = Infinity
    Array.from(track.children).forEach((child, i) => {
      const r = (child as HTMLElement).getBoundingClientRect()
      const d = Math.abs(r.left + r.width / 2 - centre)
      if (d < best) { best = d; nearest = i }
    })
    setActive(nearest)
  }, [])

  // Auto-advance through the panels, wrapping at the end. Paused on hover/focus
  // and disabled when the user prefers reduced motion. Re-arms whenever `active`
  // changes, so a manual nav simply restarts the dwell timer.
  useEffect(() => {
    if (paused || panels.length <= 1 || prefersReducedMotion()) return
    const id = setTimeout(() => goTo((active + 1) % panels.length), AUTO_ADVANCE_MS)
    return () => clearTimeout(id)
  }, [active, paused, panels.length, goTo])

  const PrevIcon = direction === 'rtl' ? ChevronRightIcon : ChevronLeftIcon
  const NextIcon = direction === 'rtl' ? ChevronLeftIcon : ChevronRightIcon
  const multi = panels.length > 1

  return (
    <section
      id="about"
      className="bg-white py-12"
      dir={direction}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="relative mx-auto max-w-5xl px-4">
        {multi && (
          <>
            <button
              type="button"
              aria-label="הפאנל הקודם"
              onClick={() => goTo(active - 1)}
              disabled={active === 0}
              className="absolute start-1 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-border bg-white/90 p-2 text-foreground shadow-sm hover:bg-white disabled:opacity-30 sm:block"
            >
              <PrevIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="הפאנל הבא"
              onClick={() => goTo(active + 1)}
              disabled={active === panels.length - 1}
              className="absolute end-1 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-border bg-white/90 p-2 text-foreground shadow-sm hover:bg-white disabled:opacity-30 sm:block"
            >
              <NextIcon className="h-5 w-5" />
            </button>
          </>
        )}

        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="flex snap-x snap-mandatory gap-0 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {panels.map((panel) => (
            <div key={panel.id} className="w-full shrink-0 snap-center px-2 sm:px-8">
              {panel.node}
            </div>
          ))}
        </div>

        {multi && (
          <div className="mt-6 flex justify-center gap-2">
            {panels.map((panel, i) => (
              <button
                key={panel.id}
                type="button"
                data-testid="panel-dot"
                aria-current={i === active}
                aria-label={`פאנל ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-2.5 rounded-full transition-all ${
                  i === active ? 'w-6 bg-primary' : 'w-2.5 bg-slate-300 hover:bg-slate-400'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
