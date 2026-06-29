import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import GallerySection from '@/components/sections/GallerySection'
import galleryData from '@/data/gallery.json'

describe('GallerySection', () => {
  it('renders every gallery image by default', () => {
    const { container } = render(<GallerySection />)
    expect(container.querySelectorAll('img')).toHaveLength(galleryData.length)
  })

  it('caps the grid to maxItems when provided (keeps the panel short)', () => {
    const { container } = render(<GallerySection maxItems={4} />)
    expect(container.querySelectorAll('img')).toHaveLength(4)
  })
})
