import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
 * The identity cluster as a fixed-height "stage": a labeled section index (tabs)
 * navigates between full-width panels (Who we are · Our MKs · FAQ · Meet us ·
 * Gallery) that snap-scroll horizontally and auto-advance. The stage has one fixed
 * height so the section is always ~one screen regardless of the active panel; tall
 * panels scroll inside their own frame, short panels centre. The MK and Meet-us
 * panels are included only when their data is present. Owns the `#about` anchor.
 */
export default function HomePanels() {
  const { t } = useTranslation()
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
    { id: 'gallery', node: <GallerySection maxItems={8} /> },
  ]

  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(i, panels.length - 1))
    // Scroll the carousel track itself, never the window. `scrollIntoView` would
    // walk up every scroll ancestor and yank the whole page to this section on each
    // auto-advance; centring the panel via the track's own scrollLeft keeps the
    // motion contained. The client-rect delta is direction-agnostic (works RTL/LTR).
    const track = trackRef.current
    const panel = track?.children[clamped] as HTMLElement | undefined
    if (track && panel) {
      const trackRect = track.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const delta = panelRect.left + panelRect.width / 2 - (trackRect.left + trackRect.width / 2)
      track.scrollTo?.({ left: track.scrollLeft + delta, behavior: 'smooth' })
    }
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

  // Roving-tabindex keyboard nav for the tab row (RTL: Left = forward).
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const focusTab = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(i, panels.length - 1))
    goTo(clamped)
    tabRefs.current[clamped]?.focus()
  }, [goTo, panels.length])
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    if (e.key === forward) { e.preventDefault(); focusTab(active + 1) }
    else if (e.key === backward) { e.preventDefault(); focusTab(active - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focusTab(0) }
    else if (e.key === 'End') { e.preventDefault(); focusTab(panels.length - 1) }
  }

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
      <div className="mx-auto max-w-5xl px-4">
        {/* Labeled section index — names every panel and acts as the nav. */}
        {multi && (
          <div
            role="tablist"
            aria-label={t('panels.about')}
            onKeyDown={onTabKeyDown}
            className="mb-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
          >
            {panels.map((panel, i) => (
              <button
                key={panel.id}
                ref={(el) => { tabRefs.current[i] = el }}
                role="tab"
                id={`tab-${panel.id}`}
                aria-controls={`panel-${panel.id}`}
                aria-selected={i === active}
                tabIndex={i === active ? 0 : -1}
                onClick={() => goTo(i)}
                className={`border-b-2 pb-1 text-sm transition-colors ${
                  i === active
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`panels.${panel.id}`)}
              </button>
            ))}
          </div>
        )}

        {/* Fixed-height stage: one screen tall regardless of the active panel. */}
        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="flex h-[clamp(440px,72vh,620px)] snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {panels.map((panel) => (
            <div
              key={panel.id}
              role="tabpanel"
              id={`panel-${panel.id}`}
              aria-labelledby={`tab-${panel.id}`}
              className="h-full w-full shrink-0 snap-center overflow-y-auto overscroll-x-contain px-2 sm:px-8"
            >
              <div className="flex min-h-full flex-col">
                <div className="my-auto w-full py-2">{panel.node}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
