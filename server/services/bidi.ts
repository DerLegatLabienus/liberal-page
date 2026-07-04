import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

/**
 * Reorder a (possibly mixed Hebrew/LTR) string from logical to VISUAL order, so a
 * renderer that lays glyphs out left-to-right without applying the Unicode bidi
 * algorithm (e.g. satori) displays Hebrew correctly. LTR runs (digits/Latin) stay put.
 */
export function toVisualOrder(str: string, baseDir: 'rtl' | 'ltr' = 'rtl'): string {
  if (!str) return str
  const { levels } = bidi.getEmbeddingLevels(str, baseDir)
  return bidi.getReorderedString(str, {
    levels,
    paragraphs: [{ start: 0, end: str.length, level: baseDir === 'rtl' ? 1 : 0 }],
  })
}
