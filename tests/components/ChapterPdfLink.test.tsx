import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ChapterPdfLink from '@/components/constitution/ChapterPdfLink'

describe('ChapterPdfLink', () => {
  it('links to the hosted PDF at the chapter page', () => {
    render(<ChapterPdfLink page={17} lang="he" />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toContain('constitution.pdf#page=17')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows a Hebrew-only note when lang is en', () => {
    render(<ChapterPdfLink page={3} lang="en" />)
    expect(screen.getByText(/Hebrew/i)).toBeInTheDocument()
  })
})
