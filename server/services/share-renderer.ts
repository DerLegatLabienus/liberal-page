import fs from 'fs'
import path from 'path'
import { toVisualOrder } from './bidi'

export interface ShareRecipientLink {
  contactId: number
  displayName: string
  url: string
}

/** One sms/whatsapp channel's resolved per-recipient send links. */
export interface ShareChannelBlock {
  kind: 'sms' | 'whatsapp'
  /** The channel's message text, shown as a visible block above the recipient links. */
  bodyText?: string
  recipients: ShareRecipientLink[]
}

/** The email channel's rendered content + pre-built send links (built once, upstream,
 *  by channel-send.ts — the single source of truth for mailto/gmail URL construction). */
export interface ShareEmailBlock {
  subject: string
  bodyHtml: string   // already sanitized at store time
  bodyPlain: string
  mailtoUrl: string
  gmailUrl: string
}

export interface ShareLetterView {
  id: number
  title: string
  recipientNames: string[]
  issueTags: string[]
  /** Absent when the letter has no enabled email channel (sms/whatsapp-only letter). */
  email?: ShareEmailBlock
  /** Enabled sms/whatsapp channels that have at least one reachable recipient. */
  channels?: ShareChannelBlock[]
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

function description(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 150 ? flat.slice(0, 149).trimEnd() + '…' : flat
}

const CHANNEL_LABELS: Record<ShareChannelBlock['kind'], string> = { sms: 'SMS', whatsapp: 'WhatsApp' }

export function renderShareHtml(view: ShareLetterView, opts: { shareBaseUrl: string; appBaseUrl: string; apiBaseUrl: string; turnstileSiteKey?: string }): string {
  const shareUrl = `${opts.shareBaseUrl}/letter/${view.id}.html`
  const imageUrl = `${opts.shareBaseUrl}/letter/${view.id}.png`
  const learnMoreUrl = `${opts.appBaseUrl}/letters/${view.id}?src=share`
  // Fall back to the title when there's no email body to summarize (sms/whatsapp-only letter).
  const desc = description(view.email?.bodyPlain || view.title)
  const tags = view.issueTags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')
  const recipients = view.recipientNames.map(esc).join(', ')
  const track = `${opts.apiBaseUrl}/api/public/letters/${view.id}/send`
  const siteKey = opts.turnstileSiteKey ?? ''
  const gated = siteKey !== ''
  const hiddenAttr = gated ? ' hidden' : ''
  const turnstileScript = gated
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : ''
  const gateCallbacks = gated
    ? `<script>function tsSolved(){var c=document.getElementById('letter-content');if(c)c.removeAttribute('hidden');var g=document.getElementById('gate');if(g)g.setAttribute('hidden','');}function tsError(){var f=document.getElementById('gate-fallback');if(f)f.removeAttribute('hidden');}</script>`
    : ''
  const gateBlock = gated
    ? `<div id="gate">
       <p class="note">לפני הצפייה, אנא אשרו שאינכם רובוט.</p>
       <div class="cf-turnstile" data-sitekey="${escAttr(siteKey)}" data-callback="tsSolved" data-error-callback="tsError" data-timeout-callback="tsError"></div>
     </div>
     <div id="gate-fallback" hidden><a class="learn" href="${learnMoreUrl}">לצפייה במכתב באתר ←</a></div>`
    : ''

  // Email is the primary content: subject/body + mailto/gmail/copy buttons, same as before.
  // Rendered only when the letter has an enabled email channel — omitted (not blank) otherwise.
  const emailBlock = view.email
    ? `<div class="body">${view.email.bodyHtml}</div>
    <div class="actions">
      <a class="btn" id="send-mailto" href="${escAttr(view.email.mailtoUrl)}">שלחו במייל</a>
      <a class="btn" id="send-gmail" href="${escAttr(view.email.gmailUrl)}" target="_blank" rel="noopener">פתחו ב-Gmail</a>
      <button class="btn secondary" id="copy-btn" type="button">העתקת המכתב</button>
    </div>`
    : ''

  // Sms/whatsapp: one link per resolved recipient, wired to a beacon that carries the
  // contactId so per-official breakdowns work the same way the member detail page does.
  // Kept inside the same turnstile gate as the email block for a single, consistent gate
  // rather than a second exemption path.
  const channelBlocks = (view.channels ?? [])
    .filter((c) => c.recipients.length > 0)
    .map((c) => {
      const links = c.recipients
        .map((r) => {
          // WhatsApp wa.me URLs open in a new tab; SMS sms: handlers don't need it.
          const targetRel = c.kind === 'whatsapp' ? ' target="_blank" rel="noopener noreferrer"' : ''
          return `<a class="recipient" href="${escAttr(r.url)}" data-kind="${c.kind}" data-contact-id="${r.contactId}"${targetRel}>שליחה ל${esc(r.displayName)}</a>`
        })
        .join('\n      ')
      const bodyBlock = c.bodyText ? `<div class="chan-body">${esc(c.bodyText)}</div>` : ''
      return `<div class="channel-block">
      <h2 class="channel-title">${esc(CHANNEL_LABELS[c.kind])}</h2>
      ${bodyBlock}
      ${links}
    </div>`
    })
    .join('\n    ')

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
  .chan-body { line-height:1.7; white-space:pre-wrap; }
  .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:24px; }
  .btn { flex:1 1 160px; text-align:center; background:#1d4ed8; color:#fff; text-decoration:none; padding:14px; border-radius:8px; font-weight:600; border:0; font-size:16px; cursor:pointer; }
  .btn.secondary { background:#e2e8f0; color:#0f172a; }
  .note { color:#64748b; font-size:12px; margin-top:16px; text-align:center; }
  .learn { display:block; text-align:center; margin-top:12px; color:#1d4ed8; font-size:13px; }
  .channel-block { margin-top:20px; }
  .channel-title { font-size:14px; color:#475569; margin:0 0 8px; }
  .recipient { display:block; background:#e2e8f0; color:#0f172a; text-decoration:none; padding:10px 14px; border-radius:8px; margin-bottom:6px; font-weight:600; }
</style>
${gateCallbacks}
${turnstileScript}
</head>
<body>
  <div class="card">
    ${gateBlock}
    <div id="letter-content"${hiddenAttr}>
    <div>${tags}</div>
    <h1>${esc(view.title)}</h1>
    ${recipients ? `<div class="to">אל: ${recipients}</div>` : ''}
    ${emailBlock}
    ${channelBlocks}
    <p class="note">המשלוחים נספרים באופן אנונימי ומצרפי בלבד — הפלטפורמה אינה מתעדת מי שלח מכתב.</p>
    <a class="learn" href="${learnMoreUrl}">על הליברלים בליכוד ←</a>
    </div>
  </div>
  <script>
    (function () {
      var track = ${JSON.stringify(track)};
      function ping(action, contactId) {
        try {
          var t = (window.turnstile && turnstile.getResponse()) || '';
          var url = track + '?action=' + action + (contactId != null ? '&contactId=' + contactId : '');
          navigator.sendBeacon(url, t);
        } catch (e) {}
      }
      var m = document.getElementById('send-mailto'); if (m) m.addEventListener('click', function () { ping('mailto'); });
      var g = document.getElementById('send-gmail'); if (g) g.addEventListener('click', function () { ping('gmail'); });
      var c = document.getElementById('copy-btn');
      if (c) c.addEventListener('click', function () {
        var body = document.querySelector('.body');
        var rtlHtml = '<div dir="rtl" style="text-align:right">' + body.innerHTML + '</div>';
        var plain = body.innerText;
        var done = function () { ping('copy'); c.textContent = 'הועתק ✓'; };
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([rtlHtml], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          })]).then(done).catch(function () { navigator.clipboard.writeText(plain).then(done); });
        } else { navigator.clipboard.writeText(plain).then(done); }
      });
      var recipientLinks = document.querySelectorAll('.recipient');
      for (var i = 0; i < recipientLinks.length; i++) {
        (function (a) {
          a.addEventListener('click', function () { ping(a.getAttribute('data-kind'), a.getAttribute('data-contact-id')); });
        })(recipientLinks[i]);
      }
    })();
  </script>
</body>
</html>`
}

let heeboFont: Buffer | null = null
function getFont(): Buffer {
  if (!heeboFont) heeboFont = fs.readFileSync(path.join(process.cwd(), 'server/assets/fonts/Heebo-Bold.ttf'))
  return heeboFont
}

function clamp(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s }

/** Build the satori node for the 1200x630 OG card, with every text run reordered to
 *  VISUAL order (satori has no bidi, so Hebrew would otherwise render reversed). */
export function buildOgCardNode(view: ShareLetterView) {
  return {
    type: 'div',
    props: {
      style: {
        width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: '64px', backgroundColor: '#1d4ed8',
        color: '#ffffff', direction: 'rtl', textAlign: 'right', fontFamily: 'Heebo',
      },
      children: [
        { type: 'div', props: { style: { fontSize: 32, opacity: 0.85 }, children: toVisualOrder('הליברלים בליכוד') } },
        { type: 'div', props: { style: { fontSize: 72, fontWeight: 700, lineHeight: 1.15 }, children: toVisualOrder(clamp(view.title, 90)) } },
        { type: 'div', props: { style: { fontSize: 36, opacity: 0.95 }, children: toVisualOrder('הצטרפו ושלחו לחבר הכנסת ←') } },
      ],
    },
  }
}

/** 1200x630 branded share card: wordmark + letter title + CTA line. Hebrew/RTL. */
export async function renderShareImage(view: ShareLetterView): Promise<Buffer> {
  const { default: satori } = await import('satori')
  const { Resvg } = await import('@resvg/resvg-js')
  const svg = await satori(buildOgCardNode(view) as Parameters<typeof satori>[0], {
    width: 1200, height: 630,
    fonts: [{ name: 'Heebo', data: getFont(), weight: 700, style: 'normal' }],
  })
  return Buffer.from(new Resvg(svg).render().asPng())
}
