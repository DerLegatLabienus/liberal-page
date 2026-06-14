import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import type { LetterWithStats, LetterIssueTag, LetterContact, LetterTemplate } from '@/types'

type Tab = 'letters' | 'tags' | 'contacts' | 'templates'

export default function AdminLettersPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('letters')
  const [letters, setLetters] = useState<LetterWithStats[]>([])
  const [tags, setTags] = useState<LetterIssueTag[]>([])
  const [contacts, setContacts] = useState<LetterContact[]>([])
  const [templates, setTemplates] = useState<LetterTemplate[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { refresh() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    setLoading(true)
    try {
      if (tab === 'letters') setLetters((await api.admin.letters.list()).letters)
      else if (tab === 'tags') setTags((await api.admin.letters.tags.list()).tags)
      else if (tab === 'contacts') setContacts((await api.admin.letters.contacts.list()).contacts)
      else if (tab === 'templates') setTemplates((await api.admin.letters.letterTemplates.list()).templates)
    } finally {
      setLoading(false)
    }
  }

  if (!user || user.role !== 'admin') {
    return <div className="p-8 text-center text-muted-foreground">Admin access required.</div>
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'letters', label: 'Letters' },
    { key: 'tags', label: 'Issue Tags' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'templates', label: 'Letter Templates' },
  ]

  return (
    <div className="min-h-screen bg-background">
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
            </div>
            <NewLetterForm onCreate={async (body) => { await api.admin.letters.create(body); refresh() }} />
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
                    <td className="py-2 pr-4">{letter.totalSends}</td>
                    <td className="py-2">
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
          <div>
            <h2 className="mb-4 text-lg font-semibold">Letter Templates ({templates.length})</h2>
            <div className="space-y-4">
              {templates.map((tpl) => (
                <div key={tpl.id} className="rounded border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">{tpl.name}</span>
                    <button
                      type="button"
                      onClick={async () => { await api.admin.letters.letterTemplates.delete(tpl.id); refresh() }}
                      className="text-xs text-destructive hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                  <iframe
                    srcDoc={tpl.html.replace('{{CONTENT}}', '<em>Sample content goes here.</em>')}
                    className="h-48 w-full rounded border"
                    sandbox="allow-same-origin"
                    title={tpl.name}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type NewLetterBody = {
  title: string; subject: string; bodyHtml: string
  toAddresses: { email: string; display_name: string }[]
  status: string; priority: string
}

function NewLetterForm({ onCreate }: { onCreate: (body: NewLetterBody) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [toName, setToName] = useState('')
  const [status, setStatus] = useState('published')
  const [priority, setPriority] = useState('normal')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title || !subject || !bodyHtml || !toEmail || !toName) return
    setSaving(true)
    try {
      await onCreate({
        title, subject, bodyHtml,
        toAddresses: [{ email: toEmail, display_name: toName }],
        status, priority,
      })
      setTitle(''); setSubject(''); setBodyHtml(''); setToEmail(''); setToName('')
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
      >
        + New Letter
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-3 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">New Letter</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">To — Email *</label>
          <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} required type="email"
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="mk@knesset.gov.il" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">To — Display Name *</label>
          <input value={toName} onChange={(e) => setToName(e.target.value)} required
            className="w-full rounded border px-3 py-1.5 text-sm" placeholder="ח&quot;כ ישראל ישראלי" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm">
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}
            className="w-full rounded border px-3 py-1.5 text-sm">
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Body HTML *</label>
          <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} required rows={6}
            className="w-full rounded border px-3 py-1.5 text-sm font-mono"
            placeholder="<p>לכבוד ח&quot;כ...</p>" />
        </div>
      </div>
      <button type="submit" disabled={saving}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {saving ? 'Saving...' : 'Create Letter'}
      </button>
    </form>
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
