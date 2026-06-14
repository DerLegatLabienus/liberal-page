import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letterTemplates } from '../../server/db/schema'
import { LetterTemplatesRepository } from '../../server/repositories/letter-templates-repository'
import { stripHtml, renderLetterHtml, buildMailtoUrl } from '../../server/services/letter-utils'

describe('stripHtml', () => {
  it('strips tags and decodes common entities', () => {
    expect(stripHtml('<p>Hello &amp; <b>world</b></p>')).toBe('Hello & world')
  })

  it('turns <br> into newlines and </p> into paragraph breaks', () => {
    expect(stripHtml('<p>line one<br>line two</p><p>para two</p>')).toBe('line one\nline two\n\npara two')
  })

  it('collapses 3+ blank lines and trims', () => {
    expect(stripHtml('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb')
  })
})

describe('buildMailtoUrl', () => {
  const to = [{ email: 'mk@knesset.gov.il', display_name: 'MK' }]

  it('encodes spaces as %20, never as + (RFC 6068)', () => {
    const url = buildMailtoUrl(to, [], [], 'מכתב לחבר הכנסת', 'שלום רב, אני פונה')
    expect(url).not.toContain('+')
    expect(url).toContain('%20')
  })

  it('puts the recipient in the path and subject/body in hfields', () => {
    const url = buildMailtoUrl(to, [], [], 'Subject', 'Body')
    expect(url).toBe('mailto:mk@knesset.gov.il?subject=Subject&body=Body')
  })

  it('joins multiple recipients with commas', () => {
    const many = [
      { email: 'a@x.com', display_name: 'A' },
      { email: 'b@x.com', display_name: 'B' },
    ]
    expect(buildMailtoUrl(many, [], [], 'S', 'B')).toContain('mailto:a@x.com,b@x.com?')
  })

  it('includes cc and bcc only when present', () => {
    const cc = [{ email: 'cc@x.com', display_name: 'CC' }]
    const bcc = [{ email: 'bcc@x.com', display_name: 'BCC' }]
    const withBoth = buildMailtoUrl(to, cc, bcc, 'S', 'B')
    expect(withBoth).toContain('cc=cc%40x.com')
    expect(withBoth).toContain('bcc=bcc%40x.com')
    expect(buildMailtoUrl(to, [], [], 'S', 'B')).not.toContain('cc=')
  })

  it('percent-encodes special characters in subject and body', () => {
    const url = buildMailtoUrl(to, [], [], 'A & B', 'x=1 & y=2')
    expect(url).toContain('subject=A%20%26%20B')
    expect(url).toContain('body=x%3D1%20%26%20y%3D2')
  })
})

describe('renderLetterHtml', () => {
  const templatesRepo = new LetterTemplatesRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letterTemplates) })

  it('returns the body unchanged when no templateId is given', async () => {
    expect(await renderLetterHtml('<p>body</p>', null)).toBe('<p>body</p>')
    expect(await renderLetterHtml('<p>body</p>', undefined)).toBe('<p>body</p>')
  })

  it('returns the body unchanged when the template is not found', async () => {
    expect(await renderLetterHtml('<p>body</p>', 9999)).toBe('<p>body</p>')
  })

  it('injects the body into the template {{CONTENT}} placeholder', async () => {
    const tpl = await templatesRepo.create({ name: 'wrap', html: '<div>{{CONTENT}}</div>' })
    expect(await renderLetterHtml('<p>hi</p>', tpl.id)).toBe('<div><p>hi</p></div>')
  })
})
