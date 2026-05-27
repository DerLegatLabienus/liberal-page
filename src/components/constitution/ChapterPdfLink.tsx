export default function ChapterPdfLink({ page, lang }: { page: number; lang: string }) {
  const href = `${import.meta.env.BASE_URL}constitution.pdf#page=${page}`
  return (
    <div className="mt-3">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
      >
        {lang === 'en' ? 'Open in the constitution (PDF) ↗' : 'פתח בחוקה (PDF) ↗'}
      </a>
      {lang === 'en' && (
        <span className="ms-2 text-xs text-muted-foreground">(Hebrew original)</span>
      )}
    </div>
  )
}
