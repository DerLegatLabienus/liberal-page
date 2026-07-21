import { Skeleton } from "@/components/ui/skeleton"

/**
 * Generic structural loading placeholder for a table/row-list: an optional header bar row plus
 * `rows` rows of `cols` cell bars. Mirrors the shape of admin tables/lists so content lands without
 * layout shift. The last cell is narrower to read like an "actions" column.
 */
function TableSkeleton({ rows = 5, cols = 4, header = true }: { rows?: number; cols?: number; header?: boolean }) {
  const cell = (i: number) => (
    <Skeleton key={i} className={`h-4 ${i === cols - 1 ? 'w-12' : 'flex-1'}`} />
  )
  return (
    <div role="status" aria-label="Loading" className="w-full space-y-3">
      {header && (
        <div className="flex items-center gap-4 border-b border-border pb-2">
          {Array.from({ length: cols }).map((_, i) => cell(i))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((_, i) => cell(i))}
        </div>
      ))}
    </div>
  )
}

export { TableSkeleton }
