import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Token-styled native `<select>` — matches `Input`'s look. Native (not a custom listbox) keeps it
 * accessible for free. Use this instead of a raw `<select>` per docs/design-system.md.
 */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Select }
