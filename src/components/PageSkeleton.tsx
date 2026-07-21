import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Full-page "vague" loading placeholder — a few faint pulsing bars while the session restores or a
 * lazy route chunk loads. Dir-neutral (no visible text), so it can't reproduce the RTL bidi bug the
 * old "Loading…" had. A visually-hidden status text announces loading to screen readers.
 */
export default function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-3xl space-y-4 p-8', className)}>
      <span role="status" className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
