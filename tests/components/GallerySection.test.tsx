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

describe('GallerySection — design tokens only', () => {
  // Raw Tailwind palette classes (bg-white, bg-slate-100, hover:bg-black/70, text-white/80 …).
  const PALETTE_CLASS = /^(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?$/

  function paletteClasses(root: Element): string[] {
    return [root, ...Array.from(root.querySelectorAll('*'))]
      .flatMap((el) => Array.from(el.classList))
      .filter((c) => PALETTE_CLASS.test(c))
  }

  it('the pattern catches raw palette classes', () => {
    for (const c of ['bg-white', 'bg-slate-100', 'hover:bg-black/70', 'text-white/80', 'ring-white']) {
      expect(c).toMatch(PALETTE_CLASS)
    }
    for (const c of ['bg-card', 'bg-muted', 'text-primary', 'border-border', 'ring-transparent', 'bg-scrim/95', 'text-scrim-foreground/80']) {
      expect(c).not.toMatch(PALETTE_CLASS)
    }
  })

  it('renders no palette class in the grid', () => {
    const { container } = render(<GallerySection maxItems={4} />)
    expect(paletteClasses(container)).toEqual([])
  })

  it('renders no palette class in the lightbox', async () => {
    render(<GallerySection maxItems={4} />)
    await userEvent.click(screen.getByTestId('gallery-view-all'))
    // The lightbox is portalled outside the section's container. Scan this section's own panel
    // (the parent of its arrows); the shared Dialog backdrop belongs to ui/dialog, not this issue.
    const panel = screen.getByRole('button', { name: 'Next' }).parentElement!
    expect(panel).toHaveClass('bg-scrim/95')
    expect(paletteClasses(panel)).toEqual([])
  })
})
