import { describe, it, expect } from 'vitest'
import { sanitizeFilename, shouldKeepUrl, resolveFilename } from '../../scripts/migrate-media'

describe('sanitizeFilename', () => {
  it('extracts filename and lowercases it', () => {
    expect(sanitizeFilename('https://example.com/wp-content/uploads/2020/05/Photo.JPG'))
      .toBe('photo.jpg')
  })

  it('replaces spaces with hyphens', () => {
    expect(sanitizeFilename('https://example.com/foo bar.png')).toBe('foo-bar.png')
  })

  it('collapses consecutive hyphens', () => {
    expect(sanitizeFilename('https://example.com/foo--bar.jpg')).toBe('foo-bar.jpg')
  })

  it('strips query strings', () => {
    expect(sanitizeFilename('https://example.com/foo.jpg?w=300')).toBe('foo.jpg')
  })

  it('strips leading/trailing hyphens', () => {
    expect(sanitizeFilename('https://example.com/-foo-.jpg')).toBe('foo.jpg')
  })

  it('falls back to "image" for fully non-ASCII filenames', () => {
    expect(sanitizeFilename('https://likudliberal.org/wp-content/uploads/אמיר-כץ.jpg')).toBe('image.jpg')
  })

  it('handles a realistic WordPress thumbnail URL', () => {
    expect(sanitizeFilename('https://likudliberal.org/wp-content/uploads/2020/05/amir1-300x282.jpg')).toBe('amir1-300x282.jpg')
  })
})

describe('shouldKeepUrl', () => {
  it('keeps likudliberal.org wp-content/uploads URLs', () => {
    expect(shouldKeepUrl('https://likudliberal.org/wp-content/uploads/2020/05/photo.jpg')).toBe(true)
  })

  it('rejects URLs from external domains', () => {
    expect(shouldKeepUrl('https://cdn.example.com/wp-content/uploads/photo.jpg')).toBe(false)
  })

  it('rejects wp-includes URLs', () => {
    expect(shouldKeepUrl('https://likudliberal.org/wp-includes/images/spinner.gif')).toBe(false)
  })

  it('rejects wp-content/themes URLs', () => {
    expect(shouldKeepUrl('https://likudliberal.org/wp-content/themes/mytheme/logo.png')).toBe(false)
  })

  it('rejects wp-content/plugins URLs', () => {
    expect(shouldKeepUrl('https://likudliberal.org/wp-content/plugins/slider/arrow.png')).toBe(false)
  })

  it('rejects URLs not containing wp-content/uploads', () => {
    expect(shouldKeepUrl('https://likudliberal.org/custom/path/image.jpg')).toBe(false)
  })

  it('rejects URLs that prefix-match the domain but are on a different host', () => {
    expect(shouldKeepUrl('https://likudliberal.org.evil.com/wp-content/uploads/photo.jpg')).toBe(false)
  })
})

describe('resolveFilename', () => {
  it('returns original name when no collision', () => {
    expect(resolveFilename('photo.jpg', new Set())).toBe('photo.jpg')
  })

  it('appends -1 on first collision', () => {
    expect(resolveFilename('photo.jpg', new Set(['photo.jpg']))).toBe('photo-1.jpg')
  })

  it('increments counter until free', () => {
    expect(resolveFilename('photo.jpg', new Set(['photo.jpg', 'photo-1.jpg']))).toBe('photo-2.jpg')
  })
})
