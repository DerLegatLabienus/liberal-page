import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { XIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type AuthUser, type Invite } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'

export default function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [invites, setInvites] = useState<Invite[]>([])
  const [users, setUsers] = useState<AuthUser[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [inv, usr] = await Promise.all([api.admin.listInvites(), api.admin.listUsers()])
      setInvites(inv.invites)
      setUsers(usr.users)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    }
  }, [])

  useEffect(() => { if (open) void load() }, [open, load])

  const addInvite = async () => {
    if (!email.trim()) return
    setError(null)
    try { await api.admin.addInvite(email.trim().toLowerCase(), role); setEmail(''); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
  }

  const removeInvite = async (e: string) => { await api.admin.removeInvite(e); await load() }

  const toggleRole = async (u: AuthUser) => {
    setError(null)
    try { await api.admin.setRole(u.id, u.role === 'admin' ? 'member' : 'admin'); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <div className="relative max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 text-slate-900 shadow-2xl" dir="rtl">
          <DialogClose className="absolute end-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-slate-100">
            <XIcon className="h-5 w-5" /><span className="sr-only">Close</span>
          </DialogClose>
          <h2 className="mb-4 text-lg font-bold">{t('admin.title')}</h2>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

          <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('admin.invites')}</h3>
            <div className="mb-3 flex gap-2">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('admin.email_placeholder')} className="flex-1" />
              <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} className="rounded-md border border-border px-2 text-sm">
                <option value="member">{t('admin.role_member')}</option>
                <option value="admin">{t('admin.role_admin')}</option>
              </select>
              <Button size="sm" onClick={addInvite}>{t('admin.invite_add')}</Button>
            </div>
            <ul className="space-y-1">
              {invites.map((inv) => (
                <li key={inv.email} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-sm">
                  <span>{inv.email} <span className="text-xs text-muted-foreground">({inv.role})</span></span>
                  <button onClick={() => removeInvite(inv.email)} className="text-xs text-red-400 hover:text-red-600">{t('admin.remove')}</button>
                </li>
              ))}
              {invites.length === 0 && <li className="px-3 py-1.5 text-sm text-muted-foreground">{t('admin.no_invites')}</li>}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('admin.users')}</h3>
            <ul className="space-y-1">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-sm">
                  <span>{u.name ?? u.email} <span className="text-xs text-muted-foreground">({u.role})</span></span>
                  <button
                    onClick={() => toggleRole(u)}
                    disabled={u.id === user?.id}
                    className="text-xs text-primary hover:underline disabled:opacity-40"
                  >
                    {u.role === 'admin' ? t('admin.make_member') : t('admin.make_admin')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
