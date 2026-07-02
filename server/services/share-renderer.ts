import fs from 'fs'
import path from 'path'

export interface ShareLetterView {
  id: number
  title: string
  subject: string
  bodyHtml: string   // already sanitized at store time
  bodyPlain: string
  recipientNames: string[]
  issueTags: string[]
}

/** Escape a string for safe use inside an HTML attribute. */
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Escape a string for safe use in HTML text content (not attributes). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function description(bodyPlain: string): string {
  const flat = bodyPlain.replace(/\s+/g, ' ').trim()
  return flat.length > 150 ? flat.slice(0, 149).trimEnd() + '…' : flat
}

export function renderShareHtml(view: ShareLetterView, opts: { shareBaseUrl: string; appBaseUrl: string }): string {
  const shareUrl = `${opts.shareBaseUrl}/letter/${view.id}.html`
  const imageUrl = `${opts.shareBaseUrl}/letter/${view.id}.png`
  const ctaUrl = `${opts.appBaseUrl}/letters/${view.id}?src=share`
  const desc = description(view.bodyPlain)
  const tags = view.issueTags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')
  const recipients = view.recipientNames.map(esc).join(', ')
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(view.title)}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${escAttr(view.title)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${shareUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(view.title)}">
<meta name="twitter:description" content="${escAttr(desc)}">
<meta name="twitter:image" content="${imageUrl}">
<link rel="canonical" href="${shareUrl}">
<style>
  body { font-family: system-ui, "Heebo", sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px; }
  .card { max-width:680px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:28px; }
  .tag { display:inline-block; background:#e0ecff; color:#1d4ed8; border-radius:999px; padding:2px 10px; font-size:13px; }
  h1 { font-size:24px; margin:12px 0; }
  .to { color:#475569; font-size:14px; margin-bottom:16px; }
  .body { line-height:1.7; }
  .cta { display:block; text-align:center; margin-top:24px; background:#1d4ed8; color:#fff; text-decoration:none; padding:14px; border-radius:8px; font-weight:600; }
  .note { color:#64748b; font-size:12px; margin-top:16px; text-align:center; }
</style>
</head>
<body>
  <div class="card">
    <div>${tags}</div>
    <h1>${esc(view.title)}</h1>
    <div class="to">אל: ${recipients}</div>
    <div class="body">${view.bodyHtml}</div>
    <a class="cta" href="${ctaUrl}">הצטרפו ושלחו לחבר הכנסת</a>
    <p class="note">המשלוחים נספרים באופן אנונימי בלבד — הפלטפורמה אינה מתעדת מי שלח מכתב.</p>
  </div>
</body>
</html>`
}

let heeboFont: Buffer | null = null
function getFont(): Buffer {
  if (!heeboFont) heeboFont = fs.readFileSync(path.join(process.cwd(), 'server/assets/fonts/Heebo-Bold.ttf'))
  return heeboFont
}

function clamp(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s }

/** 1200x630 branded share card: wordmark + letter title + CTA line. Hebrew/RTL. */
export async function renderShareImage(view: ShareLetterView): Promise<Buffer> {
  const { default: satori } = await import('satori')
  const { Resvg } = await import('@resvg/resvg-js')
  // satori accepts a React-element-shaped plain object (no JSX needed).
  const node = {
    type: 'div',
    props: {
      style: {
        width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: '64px', backgroundColor: '#1d4ed8',
        color: '#ffffff', direction: 'rtl', textAlign: 'right', fontFamily: 'Heebo',
      },
      children: [
        { type: 'div', props: { style: { fontSize: 32, opacity: 0.85 }, children: 'הליברלים בליכוד' } },
        { type: 'div', props: { style: { fontSize: 72, fontWeight: 700, lineHeight: 1.15 }, children: clamp(view.title, 90) } },
        { type: 'div', props: { style: { fontSize: 36, opacity: 0.95 }, children: 'הצטרפו ושלחו לחבר הכנסת ←' } },
      ],
    },
  }
  const svg = await satori(node as Parameters<typeof satori>[0], {
    width: 1200, height: 630,
    fonts: [{ name: 'Heebo', data: getFont(), weight: 700, style: 'normal' }],
  })
  return Buffer.from(new Resvg(svg).render().asPng())
}
