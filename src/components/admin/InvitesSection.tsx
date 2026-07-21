import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/contexts/ToastContext'
import { api, type Invite } from '@/lib/api-client'

/** Allowlist management: add an invited email + role (sends an invitation), list, and remove. */
export default function InvitesSection() {
  const { toast } = useToast()
  const [invites, setInvites] = useState<Invite[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setInvites((await api.admin.listInvites()).invites) }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to load invites', 'error') }
  }, [toast])

  useEffect(() => { void load() }, [load])

  const add = async () => {
    const value = email.trim().toLowerCase()
    if (!value || busy) return
    setBusy(true)
    try {
      await api.admin.addInvite(value, role)
      setEmail('')
      toast('Invitation sent', 'success')
      await load()
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to add invite', 'error') }
    finally { setBusy(false) }
  }

  const remove = async (invitee: string) => {
    try { await api.admin.removeInvite(invitee); toast('Invite removed', 'success'); await load() }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to remove invite', 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add() } }}
          placeholder="Email to invite"
          type="email"
          className="flex-1"
        />
        <Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} className="sm:w-36">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </Select>
        <Button onClick={() => void add()} disabled={busy || !email.trim()}>Add</Button>
      </div>

      <ul className="space-y-1.5">
        {invites.map((inv) => (
          <li key={inv.email} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
            <span>{inv.email} <span className="text-xs text-muted-foreground">({inv.role})</span></span>
            <Button variant="destructive" size="sm" onClick={() => void remove(inv.email)}>Remove</Button>
          </li>
        ))}
        {invites.length === 0 && <li className="px-1 py-2 text-sm text-muted-foreground">No invites yet.</li>}
      </ul>
    </div>
  )
}
