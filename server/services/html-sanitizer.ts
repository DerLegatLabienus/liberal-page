import sanitizeHtml from 'sanitize-html'

/**
 * Strict allowlist sanitizer for letter and template HTML. Admin- and AI-authored
 * HTML is stored and later rendered in contexts where scripts CAN execute (the Blob
 * "open in new tab" path and rich-clipboard paste), so we strip anything executable:
 * <script>/<style>, on* handlers, and javascript:/data: URLs are removed. Basic
 * formatting + letterhead markup (incl. images for branded templates) is allowed.
 *
 * The `{{CONTENT}}` template placeholder is plain text and passes through untouched.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's',
    'a', 'ul', 'ol', 'li', 'blockquote', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'figure', 'figcaption', 'header', 'footer', 'section', 'article',
  ],
  allowedAttributes: {
    '*': ['dir', 'style', 'align', 'class'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
  },
  // Only safe URL schemes; blocks javascript: and data: (the latter except images below).
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  // Drop the whole element + contents for these (default keeps text of <style>).
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
}

export function sanitizeLetterHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}
