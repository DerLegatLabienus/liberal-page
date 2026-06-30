export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface ImageValidation {
  ok: boolean
  contentType?: string
  ext?: string
  reason?: string
}

export function validateImage(buf: Buffer): ImageValidation {
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too large' }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ok: true, contentType: 'image/png', ext: 'png' }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ok: true, contentType: 'image/jpeg', ext: 'jpg' }
  }
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) {
    return { ok: true, contentType: 'image/gif', ext: 'gif' }
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { ok: true, contentType: 'image/webp', ext: 'webp' }
  }
  return { ok: false, reason: 'unsupported type' }
}
