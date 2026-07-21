import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/contexts/ToastContext'
import { api } from '@/lib/api-client'

type Flag = { enabled: boolean; value: string | null }

/** Pick a feature flag, toggle enabled, edit its value, and save to the DB. */
export default function FeatureFlagsSection() {
  const { toast } = useToast()
  const [flags, setFlags] = useState<Record<string, Flag>>({})
  const [selected, setSelected] = useState('')

  const load = useCallback(async () => {
    try {
      const flg = await api.featureFlags.get()
      setFlags(flg)
      setSelected((prev) => prev || Object.keys(flg)[0] || '')
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to load flags', 'error') }
  }, [toast])

  useEffect(() => { void load() }, [load])

  const edit = (name: string, patch: Partial<Flag>) =>
    setFlags((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))

  const save = async (name: string) => {
    const f = flags[name]
    try { await api.admin.featureFlags.update(name, { enabled: f.enabled, value: f.value }); toast('Flag saved', 'success'); await load() }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to save flag', 'error') }
  }

  const names = Object.keys(flags)
  const current = selected ? flags[selected] : null

  if (names.length === 0) return <p className="text-sm text-muted-foreground">No feature flags.</p>

  return (
    <div className="space-y-3">
      <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="font-mono text-xs">
        {names.map((name) => <option key={name} value={name}>{name}</option>)}
      </Select>

      {current && (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              aria-label={`${selected} enabled`}
              checked={current.enabled}
              onChange={(e) => edit(selected, { enabled: e.target.checked })}
            />
            enabled
          </label>
          <Input
            value={current.value ?? ''}
            placeholder="value"
            onChange={(e) => edit(selected, { value: e.target.value || null })}
            className="flex-1"
          />
          <Button size="sm" onClick={() => void save(selected)}>Save</Button>
        </div>
      )}
    </div>
  )
}
