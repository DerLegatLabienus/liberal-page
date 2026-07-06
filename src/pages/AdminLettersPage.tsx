import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { splitSends } from '@/lib/letter-sends'
import RecipientEditor from '@/components/letters/RecipientEditor'
import MediaPanel from '@/components/letters/MediaPanel'
import HtmlCodeEditor from '@/components/admin/HtmlCodeEditor'
import type { Letter, LetterWithStats, LetterIssueTag, LetterContact, LetterTemplate, LetterAddress } from '@/types'

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
      <header className="flex items-center gap-4 border-b px-8 py-4">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">← Back to site</Link>
        <h1 className="text-xl font-semibold">Admin — Letters</h1>
      </header>

      <div className="mx-auto max-w-6xl px-8 py-6">
        <div className="mb-6 flex gap-2 border-b">
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
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Contacts ({contacts.length})</h2>
              <input
                type="search"
                onChange={async (e) => {
                  const res = await api.admin.letters.contacts.list(e.target.value || undefined)
                  setContacts(res.contacts)
                }}
                placeholder="Search..."
                className="rounded border px-3 py-1 text-sm"
              />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-muted/50">
                    <td className="py-2 pr-4">{c.displayName}</td>
                    <td className="py-2 pr-4">{c.email}</td>
                    <td className="py-2 pr-4">{c.category}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={async () => { await api.admin.letters.contacts.delete(c.id); refresh() }}
                        className="text-xs text-destructive hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

type NewLetterBody = {
  title: string; subject: string; bodyHtml: string
  toAddresses: LetterAddress[]
  ccAddresses: LetterAddress[]
  bccAddresses: LetterAddress[]
  status: Letter['status']; priority: Letter['priority']
  templateId: number | null
}

function NewLetterForm({ templates, beautifyEnabled, onOpen, onSubmit, initialLetter, onCancel }: {
  templates: LetterTemplate[]
  beautifyEnabled: boolean
  onOpen: () => void | Promise<void>
  onSubmit: (body: NewLetterBody) => Promise<void>
  initialLetter?: Letter
  onCancel?: () => void
}) {
  const isEdit = !!initialLetter
  const [open, setOpen] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState(initialLetter?.title ?? '')
  const [subject, setSubject] = useState(initialLetter?.subject ?? '')
  const [bodyHtml, setBodyHtml] = useState(initialLetter?.bodyHtml ?? '')
  const [toAddresses, setToAddresses] = useState<LetterAddress[]>(initialLetter?.toAddresses ?? [])
  const [ccAddresses, setCcAddresses] = useState<LetterAddress[]>(initialLetter?.ccAddresses ?? [])
  const [bccAddresses, setBccAddresses] = useState<LetterAddress[]>(initialLetter?.bccAddresses ?? [])
  const [showCc, setShowCc] = useState((initialLetter?.ccAddresses?.length ?? 0) > 0)
  const [showBcc, setShowBcc] = useState((initialLetter?.bccAddresses?.length ?? 0) > 0)
  const [status, setStatus] = useState<Letter['status']>(initialLetter?.status ?? 'published')
  const [priority, setPriority] = useState<Letter['priority']>(initialLetter?.priority ?? 'normal')
  const [templateId, setTemplateId] = useState<number | null>(initialLetter?.templateId ?? null)
  const [beautifying, setBeautifying] = useState(false)
  const [beautifyError, setBeautifyError] = useState<string | null>(null)

  const searchContacts = (q: string) => api.admin.letters.contacts.list(q).then((r) => r.contacts)

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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title || !subject || !bodyHtml || toAddresses.length === 0) return
    setSaving(true)
    try {
      await onSubmit({
        title, subject, bodyHtml,
        toAddresses, ccAddresses, bccAddresses,
        status, priority, templateId,
      })
      // Create mode resets the form for the next letter; edit mode is torn down by the
      // parent (clears editingLetter → the keyed remount resets everything).
      if (!isEdit) {
        setTitle(''); setSubject(''); setBodyHtml('')
        setToAddresses([]); setCcAddresses([]); setBccAddresses([])
        setShowCc(false); setShowBcc(false); setTemplateId(null)
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
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identify</div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Title *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="Internal title" />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Email Subject *</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="Re: ..." />
        </div>

        <div className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipients</div>
        <div className="col-span-2 space-y-3">
          <RecipientEditor label="To *" value={toAddresses} onChange={setToAddresses}
            search={searchContacts} allowFreeForm />
          {showCc
            ? <RecipientEditor label="Cc" value={ccAddresses} onChange={setCcAddresses} search={searchContacts} allowFreeForm />
            : <button type="button" onClick={() => setShowCc(true)} className="text-xs text-primary hover:underline">+ add Cc</button>}
          {showBcc
            ? <RecipientEditor label="Bcc" value={bccAddresses} onChange={setBccAddresses} search={searchContacts} allowFreeForm />
            : <button type="button" onClick={() => setShowBcc(true)} className="text-xs text-primary hover:underline">+ add Bcc</button>}
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
            srcDoc={(templates.find((t) => t.id === templateId)?.html ?? '{{CONTENT}}')
              .replace('{{CONTENT}}', bodyHtml || '<em>תוכן המכתב…</em>')}
            className="h-48 w-full rounded border"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
      <button type="submit" disabled={saving}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {saving ? 'Saving...' : (isEdit ? 'Save' : 'Create Letter')}
      </button>
    </form>
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
