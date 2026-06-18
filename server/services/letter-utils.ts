import { LetterTemplatesRepository } from '../repositories/letter-templates-repository'

// URL builders live in a shared module so the client (member recipient edits) and
// the server (detail endpoint) produce byte-identical URLs from one source of truth.
export { buildMailtoUrl, buildGmailComposeUrl } from '../../src/lib/letter-urls'

const templatesRepo = new LetterTemplatesRepository()

/** Strip all HTML tags, collapse whitespace. Used to generate body_plain from body_html. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Inject body_html into the chosen letter template's {{CONTENT}} placeholder.
 * Returns body_html unmodified if no templateId is provided or template not found.
 */
export async function renderLetterHtml(bodyHtml: string, templateId: number | null | undefined): Promise<string> {
  if (!templateId) return bodyHtml
  const template = await templatesRepo.getById(templateId)
  if (!template) return bodyHtml
  return template.html.replace('{{CONTENT}}', bodyHtml)
}

