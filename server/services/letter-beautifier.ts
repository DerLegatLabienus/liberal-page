import Anthropic from '@anthropic-ai/sdk'
import { sanitizeLetterHtml } from './html-sanitizer'

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
const MAX_INPUT_CHARS = 8000

// Lazily constructed so a missing key never crashes boot — only an actual beautify call
// needs it. Callers turn 'beautify_unavailable' into a 503.
let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('beautify_unavailable')
  return (client ??= new Anthropic())
}

function buildPrompt(html: string): string {
  return [
    'אתה עורך מכתבים אזרחיים בעברית הנשלחים לנבחרי ציבור (חברי כנסת, שרים, ועדות).',
    'נתון לך גוף מכתב ב-HTML או טקסט. החזר גרסה משופרת:',
    '- שמור על הכוונה, העובדות והטון של הכותב; אל תמציא טענות חדשות.',
    '- שפר ניסוח, בהירות, דקדוק וכוח שכנוע אזרחי-מנומס.',
    '- בנה מבנה תקין: פסקאות, פנייה פותחת ומשפט סיום.',
    '- החזר אך ורק HTML נקי ותקין ל-RTL: פסקאות בתוך <p dir="rtl"> (ו-<br> לפי הצורך).',
    '- אל תכלול ```, אל תוסיף הסברים, כותרות או הערות — רק ה-HTML של גוף המכתב.',
    '',
    'גוף המכתב:',
    html.slice(0, MAX_INPUT_CHARS),
  ].join('\n')
}

/** Strip a leading/trailing ```html … ``` fence if the model wrapped its output. */
function stripCodeFence(text: string): string {
  return text.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

/**
 * AI "beautify": clean formatting AND improve the writing of a letter body.
 * Output is sanitized before return — model HTML is treated as untrusted.
 * Throws Error('beautify_unavailable') when ANTHROPIC_API_KEY is unset.
 */
export async function beautifyLetterHtml(html: string): Promise<string> {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: buildPrompt(html) }],
  })
  const block = message.content[0]
  if (!block || block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return sanitizeLetterHtml(stripCodeFence(block.text))
}
