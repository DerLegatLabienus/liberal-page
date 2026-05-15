import aboutData from '@/data/about.json'
import type { AboutData } from '@/types'

const about = aboutData as AboutData

export default function AboutSection() {
  return (
    <section id="about" className="bg-slate-50 py-16" dir="rtl">
      <div className="container mx-auto max-w-2xl px-4">
        <h2 className="mb-6 text-right text-2xl font-bold text-foreground">מי אנחנו</h2>
        <div className="mb-6 space-y-4">
          {about.paragraphs.map((p, i) => (
            <p key={i} className="text-right leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </div>
        <div className="mb-8 flex flex-wrap gap-2 justify-end">
          {about.values.map((value) => (
            <span
              key={value}
              className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700"
            >
              {value}
            </span>
          ))}
        </div>

        {about.leadership && about.leadership.length > 0 && (
          <div>
            <h3 className="mb-4 text-right text-lg font-semibold text-foreground">הנהגה</h3>
            <div className="flex flex-wrap gap-6 justify-start">
              {about.leadership.map((member) => (
                <div key={member.name} className="flex items-center gap-3" dir="rtl">
                  <img
                    src={member.image}
                    alt={member.name}
                    className="h-16 w-16 rounded-full object-cover border-2 border-blue-100"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                  <div>
                    <p className="text-right font-semibold text-foreground text-sm">{member.name}</p>
                    <p className="text-right text-xs text-muted-foreground">{member.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
