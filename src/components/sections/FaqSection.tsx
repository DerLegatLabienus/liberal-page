import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'

interface FaqItemShape {
  question: string
  answer: string
}

function FaqRow({ item, direction }: { item: FaqItemShape; direction: 'rtl' | 'ltr' }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        dir={direction}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-5 text-start"
      >
        <span className="flex-1 text-start text-sm font-medium text-foreground leading-snug">
          {item.question}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        dir={direction}
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          open ? 'max-h-96 opacity-100 pb-5' : 'max-h-0 opacity-0'
        }`}
      >
        <p className="text-start text-sm text-muted-foreground leading-relaxed pe-7">
          {item.answer}
        </p>
      </div>
    </div>
  )
}

export default function FaqSection() {
  const { t } = useTranslation()
  const direction = useDirection()
  const items = t('faq.items', { returnObjects: true }) as FaqItemShape[]

  return (
    <section id="faq" className="bg-white py-12">
      <div className="container mx-auto max-w-4xl px-4">
        <h2
          dir={direction}
          className="mb-8 text-start text-2xl font-bold text-foreground"
        >
          {t('faq.heading')}
        </h2>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 shadow-sm">
          {items.map((item, i) => (
            <FaqRow key={i} item={item} direction={direction} />
          ))}
        </div>
      </div>
    </section>
  )
}
