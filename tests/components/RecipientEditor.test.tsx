import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, it, expect } from 'vitest'
import RecipientEditor from '@/components/letters/RecipientEditor'
import type { LetterContact } from '@/types'

const CONTACTS: LetterContact[] = [
  { id: 1, displayName: 'דובר משרד החינוך', email: 'dover@education.gov.il', phone: null, hasWhatsapp: false, photoUrl: null, mkSiteId: null, category: 'ministry', createdAt: '' },
  { id: 2, displayName: 'ח"כ ישראל ישראלי', email: 'mk@knesset.gov.il', phone: null, hasWhatsapp: false, photoUrl: null, mkSiteId: null, category: 'mk', createdAt: '' },
]

it('renders selected contacts as chips resolved by id', () => {
  render(<RecipientEditor label="To" value={[1]} onChange={vi.fn()} contacts={CONTACTS} />)
  expect(screen.getByText('דובר משרד החינוך')).toBeInTheDocument()
})

it('adds a contact id from the dropdown', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ delay: null })
  render(<RecipientEditor label="To" value={[]} onChange={onChange} contacts={CONTACTS} />)
  await user.type(screen.getByPlaceholderText(/הקלד/), 'דובר')
  await user.click(await screen.findByText(/dover@education.gov.il/))
  expect(onChange).toHaveBeenCalledWith([1])
})

it('removes a value chip', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ delay: null })
  render(<RecipientEditor label="To" value={[2]} onChange={onChange} contacts={CONTACTS} />)
  await user.click(screen.getByRole('button', { name: /remove/ }))
  expect(onChange).toHaveBeenCalledWith([])
})

it('does not offer already-selected contacts as candidates', async () => {
  const user = userEvent.setup({ delay: null })
  render(<RecipientEditor label="To" value={[1]} onChange={vi.fn()} contacts={CONTACTS} />)
  await user.type(screen.getByPlaceholderText(/הקלד/), 'דובר')
  expect(screen.queryByText(/dover@education.gov.il/)).not.toBeInTheDocument()
})
