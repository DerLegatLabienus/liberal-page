// src/components/letters/MediaPanel.tsx
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import type { LetterMediaAsset } from '@/types'

function snippetFor(url: string): string {
  return `<img src="${url}" alt="" style="max-width:100%" />`
}

export default function MediaPanel() {
  const [assets, setAssets] = useState<LetterMediaAsset[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  useEffect(() => {
    api.admin.letters.media.list().then((r) => setAssets(r.assets)).catch((e) => setError(String(e?.message ?? e)))
  }, [])

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setError(null)
    try {
      const { asset } = await api.admin.letters.media.upload(file)
      setAssets((prev) => [asset, ...prev])
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  const onCopy = async (a: LetterMediaAsset) => {
    await navigator.clipboard.writeText(snippetFor(a.url))
    setCopiedId(a.id)
    setTimeout(() => setCopiedId((id) => (id === a.id ? null : id)), 1500)
  }

  const onDelete = async (a: LetterMediaAsset) => {
    if (!window.confirm('Delete this image? Letters already using it will show a broken image.')) return
    await api.admin.letters.media.delete(a.id)
    setAssets((prev) => prev.filter((x) => x.id !== a.id))
  }

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">Media</h3>
      <input data-testid="media-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={onUpload} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {assets.map((a) => (
          <div key={a.id} className="rounded border p-2 text-xs">
            <img src={a.url} alt={a.filename} className="mb-1 h-24 w-full object-contain" />
            <p className="truncate" title={a.filename}>{a.filename}</p>
            <p className="text-muted-foreground">{Math.round(a.sizeBytes / 1024)} KB</p>
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => onCopy(a)} className="text-primary hover:underline">
                {copiedId === a.id ? 'Copied!' : 'Copy <img> snippet'}
              </button>
              <button type="button" onClick={() => onDelete(a)} className="text-red-500 hover:underline">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
