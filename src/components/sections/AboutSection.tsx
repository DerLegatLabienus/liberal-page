import aboutData from '@/data/about.json'
import type { AboutData } from '@/types'

const about = aboutData as AboutData

export default function AboutSection() {
  return (
    <section id="about" className="bg-white py-16" dir="rtl">
      <div className="container mx-auto max-w-4xl px-4">
        <h2 className="mb-8 text-right text-2xl font-bold text-foreground">מי אנחנו</h2>

        <div className="grid gap-12 md:grid-cols-2">
          {/* Text content */}
          <div className="space-y-4">
            {about.paragraphs.map((p, i) => (
              <p key={i} className="text-right leading-relaxed text-muted-foreground">
                {p}
              </p>
            ))}
            <div className="flex flex-wrap gap-2 justify-end pt-2">
              {about.values.map((value) => (
                <span
                  key={value}
                  className="rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-medium text-blue-700"
                >
                  {value}
                </span>
              ))}
            </div>
          </div>

          {/* Leadership */}
          {about.leadership && about.leadership.length > 0 && (
            <div>
              <h3 className="mb-6 text-right text-base font-semibold text-muted-foreground uppercase tracking-wide">
                הנהגה
              </h3>
              <div className="space-y-4">
                {about.leadership.map((member) => (
                  <div key={member.name} className="flex items-center gap-4" dir="rtl">
                    <img
                      src={member.image}
                      alt={member.name}
                      className="h-14 w-14 shrink-0 rounded-full object-cover border-2 border-blue-100"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                    <div>
                      <p className="text-right text-sm font-semibold text-foreground">{member.name}</p>
                      <p className="text-right text-xs text-muted-foreground">{member.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
