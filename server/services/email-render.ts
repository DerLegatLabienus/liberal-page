import { EmailTemplatesRepository } from '../repositories/email-templates-repository'

const repo = new EmailTemplatesRepository()

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function apply(tpl: string, params: Record<string, string>, raw: Set<string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = params[key] ?? ''
    return raw.has(key) ? v : escapeHtml(v)
  })
}

/** Render a template's body only (no layout). Used for repeating fragments like digest items. */
export async function renderFragment(
  name: string,
  params: Record<string, string>,
  opts?: { raw?: string[] },
): Promise<string> {
  const tpl = await repo.get(name)
  if (!tpl) throw new Error(`email template not found: ${name}`)
  return apply(tpl.html, params, new Set(opts?.raw ?? []))
}

/** Render a full email: fill the named body, then wrap it in the _layout template. */
export async function renderTemplate(
  name: string,
  params: Record<string, string>,
  opts?: { raw?: string[] },
): Promise<{ subject: string; html: string }> {
  const tpl = await repo.get(name)
  if (!tpl) throw new Error(`email template not found: ${name}`)
  const layout = await repo.get('_layout')
  if (!layout) throw new Error('email template not found: _layout')
  const raw = new Set(opts?.raw ?? [])
  // Subject is a plain-text RFC-5322 header — do not HTML-escape it
  const subject = tpl.subject.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => params[key] ?? '')
  const body = apply(tpl.html, params, raw)
  const html = apply(layout.html, { subject, content: body }, new Set(['content']))
  return { subject, html }
}
