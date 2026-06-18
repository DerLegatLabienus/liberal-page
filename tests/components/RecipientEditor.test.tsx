import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, it, expect } from 'vitest'
import RecipientEditor from '@/components/letters/RecipientEditor'
import type { LetterContact } from '@/types'

const CONTACTS: LetterContact[] = [
  { id: 1, displayName: 'דובר משרד החינוך', email: 'dover@education.gov.il', category: 'ministry', createdAt: '' },
  { id: 2, displayName: 'ח"כ ישראל ישראלי', email: 'mk@knesset.gov.il', category: 'mk', createdAt: '' },
]

function search(_q: string) { return Promise.resolve(CONTACTS) }

it('renders locked presets as non-removable chips', () => {
  render(<RecipientEditor label="To" value={[]} onChange={vi.fn()} search={search}
    lockedValue={[{ email: 'p@gov.il', display_name: 'נמען קבוע' }]} />)
  expect(screen.getByText('נמען קבוע')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /remove נמען קבוע/ })).not.toBeInTheDocument()
})

it('adds a contact from the dropdown', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ delay: null })
  render(<RecipientEditor label="To" value={[]} onChange={onChange} search={search} />)
  await user.type(screen.getByPlaceholderText(/הקלד/), 'דובר')
  await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
  await user.click(await screen.findByText(/dover@education.gov.il/))
  expect(onChange).toHaveBeenCalledWith([
    { email: 'dover@education.gov.il', display_name: 'דובר משרד החינוך', contact_id: 1 },
  ])
})

it('removes a value chip', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ delay: null })
  render(<RecipientEditor label="To" value={[{ email: 'x@y.com', display_name: 'איקס' }]}
    onChange={onChange} search={search} />)
  await user.click(screen.getByRole('button', { name: /remove איקס/ }))
  expect(onChange).toHaveBeenCalledWith([])
})

it('rejects free-form when allowFreeForm is false, accepts when true', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ delay: null })
  const { rerender } = render(
    <RecipientEditor label="To" value={[]} onChange={onChange} search={search} allowFreeForm={false} />)
  const input = screen.getByPlaceholderText(/הקלד/)
  await user.type(input, 'free@form.com{Enter}')
  expect(onChange).not.toHaveBeenCalled()

  rerender(<RecipientEditor label="To" value={[]} onChange={onChange} search={search} allowFreeForm />)
  await user.clear(input)
  await user.type(input, 'free@form.com{Enter}')
  expect(onChange).toHaveBeenCalledWith([{ email: 'free@form.com', display_name: 'free@form.com' }])
})
