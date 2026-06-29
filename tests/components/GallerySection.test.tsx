import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import GallerySection from '@/components/sections/GallerySection'
import galleryData from '@/data/gallery.json'

describe('GallerySection', () => {
  it('renders every gallery image and no view-all control by default', () => {
    const { container } = render(<GallerySection />)
    expect(container.querySelectorAll('img')).toHaveLength(galleryData.length)
    expect(screen.queryByTestId('gallery-view-all')).not.toBeInTheDocument()
  })

  it('previews up to maxItems and offers a view-all control when there are more', () => {
    const { container } = render(<GallerySection maxItems={4} />)
    expect(container.querySelectorAll('img')).toHaveLength(4)
    expect(screen.getByTestId('gallery-view-all')).toBeInTheDocument()
  })

  it('opens the lightbox from the view-all control', async () => {
    render(<GallerySection maxItems={4} />)
    await userEvent.click(screen.getByTestId('gallery-view-all'))
    // Lightbox dialog opens with its navigation controls.
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })

  it('shows a thumbnail filmstrip that jumps to any photo', async () => {
    render(<GallerySection maxItems={4} />)
    await userEvent.click(screen.getByTestId('gallery-view-all'))
    const thumbs = screen.getAllByTestId('lightbox-thumb')
    expect(thumbs).toHaveLength(galleryData.length)
    expect(thumbs[0]).toHaveAttribute('aria-current', 'true')
    await userEvent.click(thumbs[2])
    expect(screen.getAllByTestId('lightbox-thumb')[2]).toHaveAttribute('aria-current', 'true')
  })
})
