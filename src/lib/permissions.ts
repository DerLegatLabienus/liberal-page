import type { AuthUser } from '@/lib/api-client'

/**
 * Capability seam for the letters management surface. Admin-only today; when the admin role is later
 * split into granular roles (letter manager, Knesset-tracker editor, feature-flag editor, …), widen
 * this single function instead of touching every guard/nav that gates letters management.
 */
export function canManageLetters(user: AuthUser | null | undefined): boolean {
  return user?.role === 'admin'
}
