import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { EmailTemplatesRepository } from '../../server/repositories/email-templates-repository'
import { renderTemplate, renderFragment, escapeHtml } from '../../server/services/email-render'

const repo = new EmailTemplatesRepository()

describe('email-render', () => {
  beforeAll(async () => {
    await setupTestDb()
    await repo.update('_layout', { subject: '', html: '<x>{{subject}}|{{content}}</x>' })
    await repo.update('t_plain', { subject: 'Hi {{name}}', html: '<p>{{name}}</p>' })
    await repo.update('t_raw', { subject: '', html: '<ul>{{items}}</ul>' })
    repo._resetCache()
  })
  beforeEach(() => repo._resetCache())

  it('escapeHtml escapes the dangerous characters', () => {
    expect(escapeHtml('<a&"\'>')).toBe('&lt;a&amp;&quot;&#39;&gt;')
  })

  it('substitutes and HTML-escapes non-raw params, and wraps in _layout', async () => {
    const { subject, html } = await renderTemplate('t_plain', { name: '<b>' })
    expect(subject).toBe('Hi <b>')
    expect(html).toContain('<p>&lt;b&gt;</p>')
    expect(html).toContain('<x>')
  })

  it('injects raw params without escaping', async () => {
    const { html } = await renderTemplate('t_raw', { items: '<li>x</li>' }, { raw: ['items'] })
    expect(html).toContain('<ul><li>x</li></ul>')
  })

  it('renderFragment returns the body only, no layout', async () => {
    const frag = await renderFragment('t_plain', { name: 'Z' })
    expect(frag).toBe('<p>Z</p>')
  })

  it('missing key becomes empty string', async () => {
    const frag = await renderFragment('t_plain', {})
    expect(frag).toBe('<p></p>')
  })

  it('throws on an unknown template', async () => {
    await expect(renderFragment('does_not_exist', {})).rejects.toThrow(/not found/)
  })
})
