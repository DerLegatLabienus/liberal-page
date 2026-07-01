import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { FallbackTextarea } from '@/components/admin/HtmlCodeEditor'

describe('HtmlCodeEditor / FallbackTextarea', () => {
  it('renders the value and forwards placeholder, aria-label, and edits', () => {
    const onChange = vi.fn()
    render(<FallbackTextarea value="<p>hi</p>" onChange={onChange} placeholder="<p>ph</p>" ariaLabel="Body HTML" />)
    const ta = screen.getByLabelText('Body HTML')
    expect(ta).toHaveValue('<p>hi</p>')
    expect(ta).toHaveAttribute('placeholder', '<p>ph</p>')
    fireEvent.change(ta, { target: { value: '<p>new</p>' } })
    expect(onChange).toHaveBeenCalledWith('<p>new</p>')
  })
})
