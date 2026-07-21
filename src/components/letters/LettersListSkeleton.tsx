import { Skeleton } from '@/components/ui/skeleton'

/**
 * Structural loading placeholder for the member letters list — mirrors the real card layout in
 * LettersPage (a `space-y-4` stack of `bg-card` cards with a title + meta row and tag chips) so the
 * transition to real data doesn't shift the layout.
 */
export default function LettersListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="טוען מכתבים">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-5 w-12 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
