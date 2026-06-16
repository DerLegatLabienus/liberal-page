/**
 * Neutral placeholder for images that fail to load. Previously broken images were hidden
 * (`display:none`), which collapsed their box and left a layout gap. Swapping to this keeps the
 * element's size/rounding (from its className) and shows a muted square instead of vanishing.
 *
 * Inline SVG data-URI — no network request, no asset to ship.
 */
export const IMAGE_FALLBACK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
      '<rect width="96" height="96" fill="#e5e7eb"/>' +
      '<path d="M48 50a14 14 0 1 0 0-28 14 14 0 0 0 0 28Zm0 6c-13 0-24 7-24 16v4h48v-4c0-9-11-16-24-16Z" fill="#9ca3af"/>' +
      '</svg>',
  )

/** onError handler: swap a broken image to the neutral fallback once (no error loop). */
export function onImageError(e: React.SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget
  img.onerror = null
  img.src = IMAGE_FALLBACK
}
