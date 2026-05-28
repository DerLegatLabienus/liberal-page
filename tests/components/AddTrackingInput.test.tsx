import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import AddTrackingInput from '@/components/parliament/AddTrackingInput'

vi.mock('@/lib/api-client', () => ({
  api: {
    tracking: {
      add: vi.fn().mockResolvedValue({ ok: true, item: { id: 99, title: 'Test' } }),
    },
  },
}))

describe('AddTrackingInput', () => {
  it('shows type selector when a raw numeric ID is entered', async () => {
    const user = userEvent.setup()
    render(<AddTrackingInput onAdd={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/הדבק קישור/i), '12345')
    expect(await screen.findByText('הצ"ח')).toBeInTheDocument()
    expect(screen.getByText('ועדה')).toBeInTheDocument()
    expect(screen.queryByText('ח"כ')).not.toBeInTheDocument()
  })

  it('does not show type selector for a URL', async () => {
    const user = userEvent.setup()
    render(<AddTrackingInput onAdd={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/הדבק קישור/i), 'https://oknesset.org/bill/1/')
    expect(screen.queryByText('הצ"ח')).not.toBeInTheDocument()
  })

  it('calls onAdd after successful submission', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(<AddTrackingInput onAdd={onAdd} />)

    await user.type(screen.getByPlaceholderText(/הדבק קישור/i), 'https://oknesset.org/bill/1/')
    await user.click(screen.getByRole('button', { name: /הוסף/i }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
  })

  it('stacks input and button vertically on mobile', () => {
    render(<AddTrackingInput onAdd={vi.fn()} />)
    const wrapper = screen.getByPlaceholderText(/הדבק קישור/i).closest('div')
    expect(wrapper).toHaveClass('flex-col')
    expect(wrapper).toHaveClass('sm:flex-row')
    const button = screen.getByRole('button', { name: /הוסף/i })
    expect(button).toHaveClass('w-full')
    expect(button).toHaveClass('sm:w-auto')
  })
})
