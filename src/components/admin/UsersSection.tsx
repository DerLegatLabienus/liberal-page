import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { api, type AuthUser } from '@/lib/api-client'

/** All registered users; toggle admin ↔ member (self-toggle disabled). */
export default function UsersSection() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [users, setUsers] = useState<AuthUser[]>([])

  const load = useCallback(async () => {
    try { setUsers((await api.admin.listUsers()).users) }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to load users', 'error') }
  }, [toast])

  useEffect(() => { void load() }, [load])

  const toggleRole = async (u: AuthUser) => {
    try {
      await api.admin.setRole(u.id, u.role === 'admin' ? 'member' : 'admin')
      toast('Role updated', 'success')
      await load()
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to update role', 'error') }
  }

  return (
    <ul className="space-y-1.5">
      {users.map((u) => (
        <li key={u.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
          <span>{u.name ?? u.email} <span className="text-xs text-muted-foreground">({u.role})</span></span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void toggleRole(u)}
            disabled={u.id === user?.id}
            title={u.id === user?.id ? "You can't change your own role" : undefined}
          >
            {u.role === 'admin' ? 'Make member' : 'Make admin'}
          </Button>
        </li>
      ))}
      {users.length === 0 && <li className="px-1 py-2 text-sm text-muted-foreground">No users yet.</li>}
    </ul>
  )
}
