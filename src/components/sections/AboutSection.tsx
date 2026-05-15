import aboutData from '@/data/about.json'
import type { AboutData } from '@/types'

const about = aboutData as AboutData

export default function AboutSection() {
  return (
    <section id="about" className="bg-slate-50 py-16">
      <div className="container mx-auto max-w-2xl px-4">
        <h2 className="mb-6 text-2xl font-bold text-foreground">מי אנחנו</h2>
        <div className="mb-6 space-y-4">
          {about.paragraphs.map((p, i) => (
            <p key={i} className="leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {about.values.map((value) => (
            <span
              key={value}
              className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700"
            >
              {value}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
