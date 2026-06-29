import { useDirection } from '@/hooks/useDirection'
import AboutSection from '@/components/sections/AboutSection'
import LiberalsShowcase from '@/components/sections/LiberalsShowcase'
import MeetUsSection from '@/components/sections/MeetUsSection'

/**
 * The merged identity section: who we are (About + values), our MKs
 * (LiberalsShowcase), and a way to connect (MeetUs) — one section instead of
 * three. Each sub-block keeps its own guard, so the MK and Meet-us blocks
 * self-hide when their data is absent and the section still reads coherently.
 */
export default function WhoWeAreSection() {
  const direction = useDirection()

  return (
    <section id="about" className="bg-white py-12" dir={direction}>
      <div className="container mx-auto max-w-4xl space-y-12 px-4">
        <AboutSection />
        <LiberalsShowcase />
        <MeetUsSection />
      </div>
    </section>
  )
}
