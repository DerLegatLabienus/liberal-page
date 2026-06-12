import { useState, useEffect, useCallback } from 'react'
import { XIcon } from 'lucide-react'
import { useDirection } from '@/hooks/useDirection'
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api, type AuthUser, type Invite, type EmailTemplate } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'

export default function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const direction = useDirection()
  const [invites, setInvites] = useState<Invite[]>([])
  const [users, setUsers] = useState<AuthUser[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [flags, setFlags] = useState<Record<string, { enabled: boolean; value: string | null }>>({})
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [error, setError] = useState<string | null>(null)
  const [selectedFlag, setSelectedFlag] = useState<string>('')

  const load = useCallback(async () => {
    try {
      const [inv, usr, tpl, flg] = await Promise.all([
        api.admin.listInvites(), api.admin.listUsers(), api.admin.emailTemplates.list(), api.featureFlags.get(),
      ])
      setInvites(inv.invites)
      setUsers(usr.users)
      setTemplates(tpl.templates)
      setFlags(flg)
      setSelectedFlag((prev) => prev || Object.keys(flg)[0] || '')
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

  const editFlag = (name: string, patch: Partial<{ enabled: boolean; value: string | null }>) =>
    setFlags((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  const saveFlag = async (name: string) => {
    const f = flags[name]
    try { await api.admin.featureFlags.update(name, { enabled: f.enabled, value: f.value }); await load() }
    catch { setError('Failed to save flag') }
  }

  const saveTemplate = async (tpl: EmailTemplate) => {
    try { await api.admin.emailTemplates.update(tpl.name, { subject: tpl.subject, html: tpl.html }); await load() }
    catch { setError('Failed to save template') }
  }
  const editTemplate = (name: string, patch: Partial<EmailTemplate>) =>
    setTemplates((prev) => prev.map((tpl) => (tpl.name === name ? { ...tpl, ...patch } : tpl)))

  const toggleRole = async (u: AuthUser) => {
    setError(null)
    try { await api.admin.setRole(u.id, u.role === 'admin' ? 'member' : 'admin'); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') }
  }

  const flagNames = Object.keys(flags)
  const currentFlag = selectedFlag ? flags[selectedFlag] : null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <div className="relative max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 text-slate-900 shadow-2xl" dir={direction}>
          <DialogClose className="absolute end-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-slate-100">
            <XIcon className="h-5 w-5" /><span className="sr-only">Close</span>
          </DialogClose>
          <h2 className="mb-4 text-lg font-bold">Admin</h2>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

          <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Invites</h3>
            <div className="mb-3 flex gap-2">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email to invite" className="flex-1" />
              <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} className="rounded-md border border-border px-2 text-sm">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button size="sm" onClick={addInvite}>Add</Button>
            </div>
            <ul className="space-y-1">
              {invites.map((inv) => (
                <li key={inv.email} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-sm">
                  <span>{inv.email} <span className="text-xs text-muted-foreground">({inv.role})</span></span>
                  <button onClick={() => removeInvite(inv.email)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                </li>
              ))}
              {invites.length === 0 && <li className="px-3 py-1.5 text-sm text-muted-foreground">No invites</li>}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Users</h3>
            <ul className="space-y-1">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-sm">
                  <span>{u.name ?? u.email} <span className="text-xs text-muted-foreground">({u.role})</span></span>
                  <button
                    onClick={() => toggleRole(u)}
                    disabled={u.id === user?.id}
                    className="text-xs text-primary hover:underline disabled:opacity-40"
                  >
                    {u.role === 'admin' ? 'Make member' : 'Make admin'}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Email templates</h3>
            <Accordion>
              {templates.map((tpl) => (
                <AccordionItem key={tpl.name} value={tpl.name}>
                  <AccordionTrigger className="font-mono text-xs">{tpl.name}</AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 pb-1">
                      <input
                        className="w-full rounded border px-2 py-1 text-sm"
                        value={tpl.subject}
                        onChange={(e) => editTemplate(tpl.name, { subject: e.target.value })}
                        placeholder="subject"
                      />
                      <Tabs defaultValue="source">
                        <TabsList>
                          <TabsTrigger value="source">Source</TabsTrigger>
                          <TabsTrigger value="preview">Preview</TabsTrigger>
                        </TabsList>
                        <TabsContent value="source">
                          <textarea
                            className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs"
                            rows={6}
                            value={tpl.html}
                            onChange={(e) => editTemplate(tpl.name, { html: e.target.value })}
                          />
                        </TabsContent>
                        <TabsContent value="preview">
                          <iframe
                            srcDoc={tpl.html}
                            className="mt-1 h-52 w-full rounded border bg-white"
                            sandbox="allow-same-origin"
                            title={`${tpl.name} preview`}
                          />
                        </TabsContent>
                      </Tabs>
                      <Button size="sm" onClick={() => saveTemplate(tpl)}>Save</Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Feature flags</h3>
            {flagNames.length > 0 && (
              <div className="space-y-2">
                <select
                  value={selectedFlag}
                  onChange={(e) => setSelectedFlag(e.target.value)}
                  className="w-full rounded-md border border-border px-2 py-1.5 font-mono text-xs"
                >
                  {flagNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {currentFlag && (
                  <div className="flex items-center gap-2 rounded bg-slate-50 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={selectedFlag}
                      checked={currentFlag.enabled}
                      onChange={(e) => editFlag(selectedFlag, { enabled: e.target.checked })}
                    />
                    <span className="text-xs text-muted-foreground">enabled</span>
                    <input
                      className="flex-1 rounded border px-2 py-1 text-xs"
                      value={currentFlag.value ?? ''}
                      placeholder="value"
                      onChange={(e) => editFlag(selectedFlag, { value: e.target.value || null })}
                    />
                    <Button size="sm" onClick={() => saveFlag(selectedFlag)}>Save</Button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
