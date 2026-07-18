import { describe, it, expect } from 'vitest'
import { renderShareImage, type ShareLetterView } from '../../server/services/share-renderer'

const view: ShareLetterView = {
  id: 7, title: 'עצרו את חוק X', recipientNames: ['ח"כ פלוני'], issueTags: ['חירות'],
}

describe('renderShareImage', () => {
  it('produces a non-empty PNG buffer', async () => {
    const png = await renderShareImage(view)
    expect(Buffer.isBuffer(png)).toBe(true)
    expect(png.length).toBeGreaterThan(1000)
    // PNG magic number
    expect(png[0]).toBe(0x89); expect(png[1]).toBe(0x50); expect(png[2]).toBe(0x4e); expect(png[3]).toBe(0x47)
  })
})
