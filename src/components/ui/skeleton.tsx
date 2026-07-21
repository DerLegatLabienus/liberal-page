import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Faint pulsing placeholder block. Decorative by default (`aria-hidden`); pair with an
 * `sr-only` status text for a screen-reader-announced loading state. Respects reduced motion.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted/70 motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
