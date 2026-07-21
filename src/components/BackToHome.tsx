import { Link } from 'react-router-dom'
import { Home } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A "back to home" exit for inaccessible states (permissions / errors). `Link to="/"` styled with the
 * button variants. Label defaults to English (admin surfaces); pass a Hebrew label on RTL surfaces.
 */
export default function BackToHome({ label = 'Back to home', className }: { label?: string; className?: string }) {
  return (
    <Link to="/" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)}>
      <Home className="h-4 w-4" />
      {label}
    </Link>
  )
}
