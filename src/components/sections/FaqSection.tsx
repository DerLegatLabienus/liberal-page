import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import faqData from '@/data/faq.json'
import type { FaqItem } from '@/types'

const faq = faqData as FaqItem[]

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        dir="rtl"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-5 text-right"
      >
        <span className="flex-1 text-right text-sm font-medium text-foreground leading-snug">
          {item.question}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        dir="rtl"
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          open ? 'max-h-96 opacity-100 pb-5' : 'max-h-0 opacity-0'
        }`}
      >
        <p className="text-right text-sm text-muted-foreground leading-relaxed pe-7">
          {item.answer}
        </p>
      </div>
    </div>
  )
}

export default function FaqSection() {
  return (
    <section id="faq" className="bg-white py-16">
      <div className="container mx-auto max-w-4xl px-4">
        <h2
          dir="rtl"
          className="mb-8 text-right text-2xl font-bold text-foreground"
        >
          שאלות נפוצות
        </h2>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 shadow-sm">
          {faq.map((item) => (
            <FaqRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  )
}
