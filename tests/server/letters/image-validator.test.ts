import { describe, it, expect } from 'vitest'
import { validateImage, MAX_IMAGE_BYTES } from '../../server/services/image-validator'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const gif = Buffer.from('GIF89a___', 'ascii')
const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')])
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')

describe('validateImage', () => {
  it('accepts PNG/JPEG/GIF/WebP by magic bytes', () => {
    expect(validateImage(png)).toMatchObject({ ok: true, contentType: 'image/png', ext: 'png' })
    expect(validateImage(jpeg)).toMatchObject({ ok: true, contentType: 'image/jpeg', ext: 'jpg' })
    expect(validateImage(gif)).toMatchObject({ ok: true, contentType: 'image/gif', ext: 'gif' })
    const gif87 = Buffer.from('GIF87a___', 'ascii')
    expect(validateImage(gif87)).toMatchObject({ ok: true, contentType: 'image/gif', ext: 'gif' })
    expect(validateImage(webp)).toMatchObject({ ok: true, contentType: 'image/webp', ext: 'webp' })
  })

  it('rejects SVG and other content', () => {
    expect(validateImage(svg).ok).toBe(false)
    expect(validateImage(Buffer.from('hello world')).ok).toBe(false)
  })

  it('rejects buffers over the size cap', () => {
    const big = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES + 1)])
    expect(validateImage(big)).toMatchObject({ ok: false, reason: 'too large' })
    const exact = Buffer.alloc(MAX_IMAGE_BYTES)
    exact.set(Buffer.from([0x89, 0x50, 0x4e, 0x47])) // PNG magic at the start
    expect(validateImage(exact).ok).toBe(true)
  })
})
