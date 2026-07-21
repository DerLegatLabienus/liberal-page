import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorStatus } from '@/lib/api-client'
import { buildLetterPreviewDoc } from '@/lib/letter-preview'
import CopyShareLink from '@/components/letters/CopyShareLink'
import { useAuth } from '@/contexts/AuthContext'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { useMkList } from '@/hooks/useMkList'
import { splitSends } from '@/lib/letter-sends'
import RecipientEditor from '@/components/letters/RecipientEditor'
import MediaPanel from '@/components/letters/MediaPanel'
import HtmlCodeEditor from '@/components/admin/HtmlCodeEditor'
import LettersModeTabs from '@/components/letters/LettersModeTabs'
import SmsBodyEditor from '@/components/letters/SmsBodyEditor'
import type { Letter, LetterWithStats, LetterIssueTag, LetterContact, LetterTemplate, LetterChannelInput, ChannelKind } from '@/types'

type Tab = 'letters' | 'tags' | 'contacts' | 'templates'

export default function AdminLettersPage() {
  const { user, ready } = useAuth()
  const flags = useFeatureFlags()
  const beautifyEnabled = !!flags?.lettersBeautifyEnabled?.enabled
  const isAdmin = ready && user?.role === 'admin'
  const [tab, setTab] = useState<Tab>('letters')
  const [letters, setLetters] = useState<LetterWithStats[]>([])
  const [tags, setTags] = useState<LetterIssueTag[]>([])
  const [contacts, setContacts] = useState<LetterContact[]>([])
  const [templates, setTemplates] = useState<LetterTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [editingLetter, setEditingLetter] = useState<Letter | null>(null)
  const [regenBusy, setRegenBusy] = useState(false)
  const [regenResult, setRegenResult] = useState<string | null>(null)

  // Only fetch once the session is restored and confirmed admin — otherwise the request
  // fires before there's an access token and 401s on a fresh page load / deep link.
  useEffect(() => { if (isAdmin) refresh() }, [tab, isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    setLoading(true)
    try {
      if (tab === 'letters') {
        // Templates are needed for the composer's template picker, so load both.
        const [ls, tpls] = await Promise.all([
          api.admin.letters.list(),
          api.admin.letters.letterTemplates.list(),
        ])
        setLetters(ls.letters)
        setTemplates(tpls.templates)
      }
      else if (tab === 'tags') setTags((await api.admin.letters.tags.list()).tags)
      else if (tab === 'contacts') setContacts((await api.admin.letters.contacts.list()).contacts)
      else if (tab === 'templates') setTemplates((await api.admin.letters.letterTemplates.list()).templates)
    } finally {
      setLoading(false)
    }
  }

  // Wait for session restore before deciding access — a fresh load starts with user=null
  // until the refresh token is exchanged, which would otherwise flash "access required".
  if (!ready) {
    return <div className="p-8 text-center text-muted-foreground">Loading…</div>
  }

  if (!isAdmin) {
    return <div className="p-8 text-center text-muted-foreground">Admin access required.</div>
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'letters', label: 'Letters' },
    { key: 'tags', label: 'Issue Tags' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'templates', label: 'Letter Templates' },
  ]

  return (
    // Admin UI is English-only; force LTR so it aligns correctly on the RTL (Hebrew) site.
    <div className="min-h-screen bg-background" dir="ltr">
      <header className="flex items-center gap-4 border-b border-border px-8 py-4">
        <Link to="/letters" className="text-sm text-muted-foreground hover:underline">← Letters</Link>
        <h1 className="text-xl font-semibold">Manage Letters</h1>
      </header>

      <div className="mx-auto max-w-6xl px-8 py-6">
        <LettersModeTabs className="mb-6" />
        <div className="mb-6 flex gap-2 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-muted-foreground">Loading...</p>}

        {!loading && tab === 'letters' && (
          <div>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">All Letters ({letters.length})</h2>
              <div className="flex items-center gap-3">
                {regenResult && <span className="text-xs text-muted-foreground">{regenResult}</span>}
                <button
                  type="button"
                  disabled={regenBusy}
                  onClick={async () => {
                    setRegenBusy(true); setRegenResult(null)
                    try {
                      const { regenerated } = await api.admin.letters.regenerateShares()
                      setRegenResult(`Regenerated ${regenerated} share pages`)
                    } catch {
                      setRegenResult('Regenerate failed')
                    } finally {
                      setRegenBusy(false)
                    }
                  }}
                  className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  title="Rebuild the public R2 share page for every published letter"
                >
                  {regenBusy ? 'Regenerating…' : 'Regenerate share pages'}
                </button>
              </div>
            </div>
            <NewLetterForm
              key={editingLetter?.id ?? 'new'}
              templates={templates}
              beautifyEnabled={beautifyEnabled}
              initialLetter={editingLetter ?? undefined}
              onOpen={async () => { setTemplates((await api.admin.letters.letterTemplates.list()).templates) }}
              onCancel={() => setEditingLetter(null)}
              onSubmit={async (body) => {
                if (editingLetter) { await api.admin.letters.update(editingLetter.id, body); setEditingLetter(null) }
                else { await api.admin.letters.create(body) }
                refresh()
              }}
            />
            <table className="mt-6 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Priority</th>
                  <th className="py-2 pr-4">Pinned</th>
                  <th className="py-2 pr-4">Sends</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {letters.map((letter) => (
                  <tr key={letter.id} className="border-b hover:bg-muted/50">
                    <td className="py-2 pr-4 font-medium">{letter.title}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${
                        letter.status === 'published'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {letter.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{letter.priority}</td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={async () => {
                          await api.admin.letters.togglePin(letter.id, !letter.pinnedAt)
                          refresh()
                        }}
                        className="text-sm hover:underline"
                      >
                        {letter.pinnedAt ? '📌 unpin' : 'pin'}
                      </button>
                    </td>
                    <td className="py-2 pr-4">
                      {(() => { const s = splitSends(letter.breakdown); return (
                        <span title={`${s.member} member · ${s.public} public`}>
                          {s.total} <span className="text-xs text-muted-foreground">({s.public} public)</span>
                        </span>
                      ) })()}
                    </td>
                    <td className="py-2 space-x-3">
                      <button
                        type="button"
                        onClick={async () => {
                          setTemplates((await api.admin.letters.letterTemplates.list()).templates)
                          setEditingLetter(letter)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm('Delete this letter?')) {
                            await api.admin.letters.delete(letter.id)
                            refresh()
                          }
                        }}
                        className="text-xs text-destructive hover:underline"
                      >
                        Delete
                      </button>
                      {letter.shareUrl && (
                        <CopyShareLink url={letter.shareUrl} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'tags' && (
          <div>
            <h2 className="mb-4 text-lg font-semibold">Issue Tags ({tags.length})</h2>
            <NewTagForm onCreate={async (name, slug) => { await api.admin.letters.tags.create({ name, slug }); refresh() }} />
            <ul className="mt-4 space-y-2">
              {tags.map((tag) => (
                <li key={tag.id} className="flex items-center justify-between rounded border px-4 py-2">
                  <span>{tag.name} <span className="text-xs text-muted-foreground">({tag.slug})</span></span>
                  <button
                    type="button"
                    onClick={async () => { await api.admin.letters.tags.delete(tag.id); refresh() }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!loading && tab === 'contacts' && (
          <ContactsTab contacts={contacts} setContacts={setContacts} refresh={refresh} />
        )}

        {!loading && tab === 'templates' && (
          <div className="space-y-8">
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Letter Templates ({templates.length})</h2>
              </div>
              <NewTemplateForm onCreate={async (name, html) => { await api.admin.letters.letterTemplates.create({ name, html }); refresh() }} />
              <div className="mt-6 space-y-4">
                {templates.map((tpl) => (
                  <TemplateRow
                    key={tpl.id}
                    template={tpl}
                    onSave={async (name, html) => { await api.admin.letters.letterTemplates.update(tpl.id, { name, html }); refresh() }}
                    onDelete={async () => { if (confirm('Delete this template?')) { await api.admin.letters.letterTemplates.delete(tpl.id); refresh() } }}
                  />
                ))}
              </div>
            </div>
            <MediaPanel />
          </div>
        )}
      </div>
    </div>
  )
}

type ContactFormBody = {
  displayName: string
  email: string | null
  phone: string | null
  hasWhatsapp: boolean
  photoUrl: string | null
  mkSiteId: number | null
  category: string
}

/** Derives the photo to show for a contact: the linked MK's cached photo takes priority
 * over a manually-set photoUrl (the MK's photo is kept fresh by the MK list cache). */
function contactPhotoUrl(c: LetterContact, mks: { siteId: number; photoUrl: string | null }[]): string | null {
  if (c.mkSiteId != null) {
    const mk = mks.find((m) => m.siteId === c.mkSiteId)
    if (mk?.photoUrl) return mk.photoUrl
  }
  return c.photoUrl
}

function ContactAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className="h-8 w-8 rounded-full object-cover" />
  }
  const initials = name.trim().slice(0, 2).toUpperCase() || '?'
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {initials}
    </span>
  )
}

function ContactsTab({ contacts, setContacts, refresh }: {
  contacts: LetterContact[]
  setContacts: (c: LetterContact[]) => void
  refresh: () => void | Promise<void>
}) {
  const { mks } = useMkList()
  const [editing, setEditing] = useState<LetterContact | 'new' | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<Record<number, string>>({})

  async function handleDelete(id: number) {
    setDeleteErrors((prev) => { const next = { ...prev }; delete next[id]; return next })
    try {
      await api.admin.letters.contacts.delete(id)
      refresh()
    } catch (err) {
      if (errorStatus(err) === 409) {
        setDeleteErrors((prev) => ({ ...prev, [id]: 'לא ניתן למחוק — איש קשר בשימוש' }))
      } else {
        setDeleteErrors((prev) => ({ ...prev, [id]: 'המחיקה נכשלה' }))
      }
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Contacts ({contacts.length})</h2>
        <div className="flex items-center gap-2">
          <input
            type="search"
            onChange={async (e) => {
              const res = await api.admin.letters.contacts.list(e.target.value || undefined)
              setContacts(res.contacts)
            }}
            placeholder="Search..."
            className="rounded border px-3 py-1 text-sm"
          />
          {editing === null && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="rounded border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary"
            >
              + New Contact
            </button>
          )}
        </div>
      </div>

      {editing !== null && (
        <ContactForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSubmit={async (body) => {
            if (editing === 'new') await api.admin.letters.contacts.create(body)
            else await api.admin.letters.contacts.update(editing.id, body)
            setEditing(null)
            refresh()
          }}
        />
      )}

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4">Photo</th>
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Email</th>
            <th className="py-2 pr-4">Phone</th>
            <th className="py-2 pr-4">Category</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} className="border-b hover:bg-muted/50">
              <td className="py-2 pr-4">
                <ContactAvatar name={c.displayName} photoUrl={contactPhotoUrl(c, mks)} />
              </td>
              <td className="py-2 pr-4">{c.displayName}</td>
              <td className="py-2 pr-4">{c.email}</td>
              <td className="py-2 pr-4">
                {c.phone && <span>{c.phone}</span>}
                {c.hasWhatsapp && (
                  <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">WhatsApp</span>
                )}
              </td>
              <td className="py-2 pr-4">{c.category}</td>
              <td className="py-2">
                <div className="space-x-3">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="text-xs text-primary hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    className="text-xs text-destructive hover:underline"
                  >
                    Delete
                  </button>
                </div>
                {deleteErrors[c.id] && (
                  <p className="mt-1 text-xs text-destructive">{deleteErrors[c.id]}</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ContactForm({ initial, onSubmit, onCancel }: {
  initial?: LetterContact
  onSubmit: (body: ContactFormBody) => Promise<void>
  onCancel: () => void
}) {
  const isEdit = !!initial
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [hasWhatsapp, setHasWhatsapp] = useState(initial?.hasWhatsapp ?? false)
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl ?? '')
  const [mkSiteId, setMkSiteId] = useState(initial?.mkSiteId != null ? String(initial.mkSiteId) : '')
  const [category, setCategory] = useState(initial?.category ?? 'custom')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = displayName.trim() && (email.trim() || phone.trim())

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true); setError(null)
    try {
      await onSubmit({
        displayName: displayName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        hasWhatsapp,
        photoUrl: photoUrl.trim() || null,
        mkSiteId: mkSiteId.trim() ? Number(mkSiteId) : null,
        category: category.trim() || 'custom',
      })
    } catch (err) {
      setError(errorStatus(err) === 400 ? (err as Error).message : 'השמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  async function uploadPhoto(file: File) {
    setUploading(true); setError(null)
    try {
      const { asset } = await api.admin.letters.media.upload(file)
      setPhotoUrl(asset.url)
    } catch {
      setError('העלאת התמונה נכשלה')
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-3 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{isEdit ? 'Edit Contact' : 'New Contact'}</h3>
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:underline">Cancel</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Name *</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="Display name" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="name@example.com" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="05X… או ‎+9725X…" />
          <p className="mt-1 text-xs text-muted-foreground">05X… או ‎+9725X…</p>
        </div>
        <div className="col-span-2 flex items-center gap-1.5">
          <input
            id="contact-has-whatsapp"
            type="checkbox"
            checked={hasWhatsapp}
            onChange={(e) => setHasWhatsapp(e.target.checked)}
            aria-label="has WhatsApp"
          />
          <label htmlFor="contact-has-whatsapp" className="text-sm">Has WhatsApp</label>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Photo URL</label>
          <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="https://…" />
          <div className="mt-1 flex items-center gap-2">
            <input
              type="file"
              accept="image/*"
              aria-label="upload photo"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }}
              className="text-xs"
            />
            {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">MK Site ID</label>
          <input
            type="number"
            value={mkSiteId}
            onChange={(e) => setMkSiteId(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm"
            placeholder="e.g. 1116"
          />
          <p className="mt-1 text-xs text-muted-foreground">When set, the contact's photo is derived from the linked MK.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="custom" />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!valid && (displayName || email || phone) && (
        <p className="text-xs text-muted-foreground">Name and (email or phone) are required.</p>
      )}
      <button type="submit" disabled={saving || !valid}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {saving ? 'Saving...' : (isEdit ? 'Save' : 'Create Contact')}
      </button>
    </form>
  )
}

type NewLetterBody = {
  title: string
  status: Letter['status']
  priority: Letter['priority']
  issueTagIds: number[]
  channels: LetterChannelInput[]
}

const CHANNEL_LABELS: Record<ChannelKind, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
}
const CHANNEL_ORDER: ChannelKind[] = ['email', 'sms', 'whatsapp']

function NewLetterForm({ templates, beautifyEnabled, onOpen, onSubmit, initialLetter, onCancel }: {
  templates: LetterTemplate[]
  beautifyEnabled: boolean
  onOpen: () => void | Promise<void>
  onSubmit: (body: NewLetterBody) => Promise<void>
  initialLetter?: Letter
  onCancel?: () => void
}) {
  const isEdit = !!initialLetter
  const seed = initialLetter?.channels ?? []
  const seedEmail = seed.find((c) => c.kind === 'email')
  const seedSms = seed.find((c) => c.kind === 'sms')
  const seedWa = seed.find((c) => c.kind === 'whatsapp')

  const [open, setOpen] = useState(isEdit)
  const [saving, setSaving] = useState(false)

  // Shared header state
  const [title, setTitle] = useState(initialLetter?.title ?? '')
  const [status, setStatus] = useState<Letter['status']>(initialLetter?.status ?? 'published')
  const [priority, setPriority] = useState<Letter['priority']>(initialLetter?.priority ?? 'normal')
  const [issueTagIds] = useState<number[]>(initialLetter?.issueTagIds ?? [])

  // Which channels are enabled + which tab is active
  const [enabled, setEnabled] = useState<Set<ChannelKind>>(() =>
    isEdit && seed.length ? new Set(seed.map((c) => c.kind)) : new Set<ChannelKind>(['email']))
  const [activeTab, setActiveTab] = useState<ChannelKind>(() =>
    isEdit && seed.length ? seed[0].kind : 'email')

  // Email channel state
  const [subject, setSubject] = useState(seedEmail?.subject ?? '')
  const [bodyHtml, setBodyHtml] = useState(seedEmail?.bodyHtml ?? '')
  const [toIds, setToIds] = useState<number[]>(seedEmail?.recipientIds ?? [])
  const [ccIds, setCcIds] = useState<number[]>(seedEmail?.ccIds ?? [])
  const [bccIds, setBccIds] = useState<number[]>(seedEmail?.bccIds ?? [])
  const [templateId, setTemplateId] = useState<number | null>(seedEmail?.templateId ?? null)
  const [showCc, setShowCc] = useState((seedEmail?.ccIds?.length ?? 0) > 0)
  const [showBcc, setShowBcc] = useState((seedEmail?.bccIds?.length ?? 0) > 0)
  const [beautifying, setBeautifying] = useState(false)
  const [beautifyError, setBeautifyError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // SMS channel state
  const [smsIds, setSmsIds] = useState<number[]>(seedSms?.recipientIds ?? [])
  const [smsBody, setSmsBody] = useState(seedSms?.bodyText ?? '')

  // WhatsApp channel state
  const [waIds, setWaIds] = useState<number[]>(seedWa?.recipientIds ?? [])
  const [waBody, setWaBody] = useState(seedWa?.bodyText ?? '')

  // Per-channel candidate contacts (channel-filtered server-side, then filtered locally by the picker)
  const [emailContacts, setEmailContacts] = useState<LetterContact[]>([])
  const [smsContacts, setSmsContacts] = useState<LetterContact[]>([])
  const [waContacts, setWaContacts] = useState<LetterContact[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      api.letters.contacts(undefined, 'email'),
      api.letters.contacts(undefined, 'sms'),
      api.letters.contacts(undefined, 'whatsapp'),
    ]).then(([e, s, w]) => {
      if (cancelled) return
      setEmailContacts(e.contacts); setSmsContacts(s.contacts); setWaContacts(w.contacts)
    }).catch(() => { /* leave pickers empty on failure */ })
    return () => { cancelled = true }
  }, [open])

  function toggleChannel(kind: ChannelKind) {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) {
        next.delete(kind)
        // Never leave the active tab pointing at a disabled channel.
        if (activeTab === kind) {
          const fallback = CHANNEL_ORDER.find((k) => next.has(k))
          if (fallback) setActiveTab(fallback)
        }
      } else {
        next.add(kind)
        setActiveTab(kind) // jump to a freshly enabled channel
      }
      return next
    })
  }

  // Guard against an active tab that isn't enabled (e.g. after toggling it off).
  const shownTab: ChannelKind | null = enabled.has(activeTab)
    ? activeTab
    : CHANNEL_ORDER.find((k) => enabled.has(k)) ?? null

  async function beautify() {
    if (!bodyHtml.trim()) return
    setBeautifying(true); setBeautifyError(null)
    try {
      const res = await api.admin.letters.beautify(bodyHtml)
      setBodyHtml(res.html)
    } catch {
      setBeautifyError('Beautify failed (AI service may be unavailable).')
    } finally {
      setBeautifying(false)
    }
  }

  function buildChannels(): LetterChannelInput[] {
    const channels: LetterChannelInput[] = []
    if (enabled.has('email')) {
      channels.push({
        kind: 'email', recipientIds: toIds, ccIds, bccIds,
        subject, bodyHtml, bodyText: '', templateId,
      })
    }
    if (enabled.has('sms')) channels.push({ kind: 'sms', recipientIds: smsIds, bodyText: smsBody })
    if (enabled.has('whatsapp')) channels.push({ kind: 'whatsapp', recipientIds: waIds, bodyText: waBody })
    return channels
  }

  function valid(): boolean {
    if (!title.trim() || enabled.size === 0) return false
    if (enabled.has('email') && (!subject.trim() || !bodyHtml.trim() || toIds.length === 0)) return false
    if (enabled.has('sms') && !smsBody.trim()) return false
    if (enabled.has('whatsapp') && !waBody.trim()) return false
    return true
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    if (!valid()) return
    const built = buildChannels()
    if (status === 'published') {
      const empty = built.find((c) => (c.enabled ?? true) && (c.recipientIds?.length ?? 0) === 0)
      if (empty) {
        setSubmitError(`לא ניתן לפרסם: לערוץ "${empty.kind}" אין נמענים`)
        return
      }
    }
    setSaving(true)
    try {
      await onSubmit({ title, status, priority, issueTagIds, channels: built })
      // Create mode resets the form for the next letter; edit mode is torn down by the
      // parent (clears editingLetter → the keyed remount resets everything).
      if (!isEdit) {
        setTitle('')
        setSubject(''); setBodyHtml(''); setTemplateId(null)
        setToIds([]); setCcIds([]); setBccIds([]); setShowCc(false); setShowBcc(false)
        setSmsIds([]); setSmsBody(''); setWaIds([]); setWaBody('')
        setEnabled(new Set<ChannelKind>(['email'])); setActiveTab('email')
        setOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); onOpen() }}
        className="rounded border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
      >
        + New Letter
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-3 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{isEdit ? 'Edit Letter' : 'New Letter'}</h3>
        <button type="button" onClick={() => { setOpen(false); onCancel?.() }} className="text-xs text-muted-foreground hover:underline">Cancel</button>
      </div>

      {/* Shared header */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identify</div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Title *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="Internal title" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Letter['status'])}
            className="w-full rounded border px-3 py-1.5 text-sm">
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Letter['priority'])}
            className="w-full rounded border px-3 py-1.5 text-sm">
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      {/* Channel enable toggles */}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channels</div>
        <div className="flex flex-wrap gap-3">
          {CHANNEL_ORDER.map((kind) => (
            <label key={kind} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={enabled.has(kind)}
                onChange={() => toggleChannel(kind)}
                aria-label={`toggle ${CHANNEL_LABELS[kind]} channel`}
              />
              {CHANNEL_LABELS[kind]}
            </label>
          ))}
        </div>
      </div>

      {/* Tab bar — one tab per enabled channel */}
      <div className="flex gap-1 border-b">
        {CHANNEL_ORDER.filter((k) => enabled.has(k)).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setActiveTab(kind)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              shownTab === kind
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {CHANNEL_LABELS[kind]}
          </button>
        ))}
      </div>

      {/* Email tab */}
      {shownTab === 'email' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email Subject *</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded border px-3 py-1.5 text-sm" placeholder="Re: ..." />
          </div>

          <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipients</div>
          <div className="col-span-2 space-y-3">
            <RecipientEditor label="To *" value={toIds} onChange={(next) => { setToIds(next); setSubmitError(null) }} contacts={emailContacts} />
            {showCc
              ? <RecipientEditor label="Cc" value={ccIds} onChange={setCcIds} contacts={emailContacts} />
              : <button type="button" onClick={() => setShowCc(true)} className="text-xs text-primary hover:underline">+ add Cc</button>}
            {showBcc
              ? <RecipientEditor label="Bcc" value={bccIds} onChange={setBccIds} contacts={emailContacts} />
              : <button type="button" onClick={() => setShowBcc(true)} className="text-xs text-primary hover:underline">+ add Bcc</button>}
          </div>

          <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content</div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Template</label>
            <select
              value={templateId ?? ''}
              onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded border px-3 py-1.5 text-sm"
            >
              <option value="">— None (raw body) —</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              The body below is injected into the template’s <code>{'{{CONTENT}}'}</code> placeholder when the letter is viewed.
            </p>
          </div>
          <div className="col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-medium text-muted-foreground">Body HTML *</label>
              {beautifyEnabled && (
                <button
                  type="button"
                  onClick={beautify}
                  disabled={beautifying || !bodyHtml.trim()}
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {beautifying ? '✨ Beautifying…' : '✨ Beautify'}
                </button>
              )}
            </div>
            <HtmlCodeEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              ariaLabel="Body HTML"
              placeholder={'<p>לכבוד ח"כ...</p>'}
            />
            {beautifyError && <p className="mt-1 text-xs text-destructive">{beautifyError}</p>}
            {beautifyEnabled && (
              <p className="mt-1 text-xs text-muted-foreground">Beautify uses AI and may change wording — review before saving.</p>
            )}
          </div>
          <div className="col-span-2">
            <p className="mb-1 text-xs text-muted-foreground">Live preview:</p>
            <iframe
              title="composer-preview"
              srcDoc={buildLetterPreviewDoc(
                (templates.find((t) => t.id === templateId)?.html ?? '{{CONTENT}}')
                  .replace('{{CONTENT}}', bodyHtml || '<em>תוכן המכתב…</em>'),
              )}
              className="h-48 w-full rounded border"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      )}

      {/* SMS tab */}
      {shownTab === 'sms' && (
        <ChannelBodyTab
          mode="sms"
          body={smsBody} onBody={setSmsBody}
          ids={smsIds} onIds={(next) => { setSmsIds(next); setSubmitError(null) }}
          contacts={smsContacts}
        />
      )}

      {/* WhatsApp tab */}
      {shownTab === 'whatsapp' && (
        <ChannelBodyTab
          mode="whatsapp"
          body={waBody} onBody={setWaBody}
          ids={waIds} onIds={(next) => { setWaIds(next); setSubmitError(null) }}
          contacts={waContacts}
        />
      )}

      {submitError && <p className="text-xs text-destructive">{submitError}</p>}
      <button type="submit" disabled={saving || !valid()}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {saving ? 'Saving...' : (isEdit ? 'Save' : 'Create Letter')}
      </button>
    </form>
  )
}

function ChannelBodyTab({ mode, body, onBody, ids, onIds, contacts }: {
  mode: 'sms' | 'whatsapp'
  body: string
  onBody: (v: string) => void
  ids: number[]
  onIds: (next: number[]) => void
  contacts: LetterContact[]
}) {
  const label = mode === 'sms' ? 'SMS' : 'WhatsApp'
  const reachable = new Set(contacts.map((c) => c.id))
  const unreachable = ids.filter((id) => !reachable.has(id)).length
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{label} Body *</label>
        <SmsBodyEditor value={body} onChange={onBody} mode={mode} channelLabel={`${label} body`} />
      </div>
      {contacts.length === 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          אין אנשי קשר עם {mode === 'whatsapp' ? 'וואטסאפ' : 'טלפון'} — הוסיפו מספרי טלפון לאנשי הקשר לפני הפעלת הערוץ.
        </p>
      )}
      <RecipientEditor label="Recipients" value={ids} onChange={onIds} contacts={contacts} />
      <p className="text-xs text-muted-foreground">
        {unreachable} מתוך {ids.length} נמענים ללא ערוץ זה
      </p>
    </div>
  )
}

const PLACEHOLDER = '{{CONTENT}}'

function NewTemplateForm({ onCreate }: { onCreate: (name: string, html: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [html, setHtml] = useState('')
  const valid = name.trim() && html.includes(PLACEHOLDER)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    try { await onCreate(name, html); setName(''); setHtml(''); setOpen(false) }
    finally { setSaving(false) }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary">
        + New Template
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">New Template</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className="w-full rounded border px-3 py-1.5 text-sm" />
      <HtmlCodeEditor value={html} onChange={setHtml} ariaLabel="Template HTML" placeholder={`<div dir="rtl">${PLACEHOLDER}</div>`} />
      {!html.includes(PLACEHOLDER) && html.length > 0 && (
        <p className="text-xs text-destructive">HTML must contain the <code>{PLACEHOLDER}</code> placeholder.</p>
      )}
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Preview:</p>
        <iframe srcDoc={html.replace(PLACEHOLDER, '<em>תוכן המכתב…</em>')} className="h-40 w-full rounded border" sandbox="allow-same-origin" title="preview" />
      </div>
      <button type="submit" disabled={!valid || saving} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {saving ? 'Saving...' : 'Create Template'}
      </button>
    </form>
  )
}

function TemplateRow({ template, onSave, onDelete }: {
  template: LetterTemplate
  onSave: (name: string, html: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(template.name)
  const [html, setHtml] = useState(template.html)
  const [saving, setSaving] = useState(false)
  const valid = name.trim() && html.includes(PLACEHOLDER)

  async function save() {
    if (!valid) return
    setSaving(true)
    try { await onSave(name, html); setEditing(false) } finally { setSaving(false) }
  }

  return (
    <div className="rounded border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        {editing
          ? <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border px-2 py-1 text-sm" />
          : <span className="font-medium">{template.name}</span>}
        <div className="flex gap-3">
          {editing ? (
            <>
              <button type="button" onClick={save} disabled={!valid || saving} className="text-xs text-primary hover:underline disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => { setEditing(false); setName(template.name); setHtml(template.html) }} className="text-xs text-muted-foreground hover:underline">Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-primary hover:underline">Edit</button>
          )}
          <button type="button" onClick={onDelete} className="text-xs text-destructive hover:underline">Delete</button>
        </div>
      </div>
      {editing && (
        <div className="mb-2">
          <HtmlCodeEditor value={html} onChange={setHtml} ariaLabel="Template HTML" />
        </div>
      )}
      {editing && !html.includes(PLACEHOLDER) && (
        <p className="mb-2 text-xs text-destructive">HTML must contain <code>{PLACEHOLDER}</code>.</p>
      )}
      <iframe
        srcDoc={html.replace(PLACEHOLDER, '<em>תוכן המכתב…</em>')}
        className="h-48 w-full rounded border"
        sandbox="allow-same-origin"
        title={template.name}
      />
    </div>
  )
}

function NewTagForm({ onCreate }: { onCreate: (name: string, slug: string) => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name && slug) { onCreate(name, slug); setName(''); setSlug('') } }}
      className="flex gap-2"
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם התג (Hebrew)" className="rounded border px-3 py-1 text-sm" />
      <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug (english-kebab)" className="rounded border px-3 py-1 text-sm" />
      <button type="submit" className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground">Add</button>
    </form>
  )
}
