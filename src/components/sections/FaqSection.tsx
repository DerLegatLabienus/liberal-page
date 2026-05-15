import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import faqData from '@/data/faq.json'
import type { FaqItem } from '@/types'

const faq = faqData as FaqItem[]

export default function FaqSection() {
  return (
    <section id="faq" className="bg-slate-50 py-16">
      <div className="container mx-auto max-w-2xl px-4">
        <h2 className="mb-6 text-2xl font-bold text-foreground">שאלות נפוצות</h2>
        <Accordion type="single" collapsible className="w-full">
          {faq.map((item) => (
            <AccordionItem key={item.id} value={String(item.id)}>
              <AccordionTrigger className="text-sm font-medium">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="leading-relaxed text-sm text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
