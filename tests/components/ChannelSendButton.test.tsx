import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import ChannelSendButton from '@/components/letters/ChannelSendButton'
import type { ChannelSend } from '@/types'

const email: ChannelSend = {
  kind: 'email', enabled: true, bodyText: 'plain', unavailableCount: 0,
  mailtoUrl: 'mailto:a@b.c', gmailUrl: 'https://mail.google.com/x', renderedHtml: '<p>hi</p>',
}
const sms: ChannelSend = {
  kind: 'sms', enabled: true, bodyText: 'קצר', unavailableCount: 0,
  recipients: [
    { contactId: 1, displayName: 'דן', photoUrl: null, url: 'sms:+9725?&body=x' },
    { contactId: 2, displayName: 'מיכל', photoUrl: null, url: 'sms:+9726?&body=x' },
  ],
}
const noop = () => {}

describe('ChannelSendButton', () => {
  it('email: one visible send button; Gmail and copy live in the menu', async () => {
    const onGmail = vi.fn()
    const onPrimary = vi.fn()
    const u = userEvent.setup({ delay: null })
    render(<ChannelSendButton channel={email} onPrimary={onPrimary} onGmail={onGmail} onCopy={noop} onRecipient={noop} copied={false} />)

    // the alternates are not visible controls until the menu is opened
    expect(screen.queryByRole('menuitem', { name: /Gmail/ })).not.toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: /שליחה במייל/ }))
    expect(onPrimary).toHaveBeenCalled()

    await u.click(screen.getByRole('button', { name: /אפשרויות/ }))
    await u.click(screen.getByRole('menuitem', { name: /Gmail/ }))
    expect(onGmail).toHaveBeenCalled()
  })

  it('sms: the primary button opens the recipient menu and picking one fires onRecipient', async () => {
    const onRecipient = vi.fn()
    const u = userEvent.setup({ delay: null })
    render(<ChannelSendButton channel={sms} onPrimary={noop} onGmail={noop} onCopy={noop} onRecipient={onRecipient} copied={false} />)

    await u.click(screen.getByRole('button', { name: /שליחה/ }))
    await u.click(screen.getByRole('menuitem', { name: /דן/ }))
    expect(onRecipient).toHaveBeenCalledWith(expect.objectContaining({ contactId: 1 }))
  })

  it('closes the menu on Escape', async () => {
    const u = userEvent.setup({ delay: null })
    render(<ChannelSendButton channel={sms} onPrimary={noop} onGmail={noop} onCopy={noop} onRecipient={noop} copied={false} />)
    await u.click(screen.getByRole('button', { name: /שליחה/ }))
    expect(screen.getByRole('menuitem', { name: /דן/ })).toBeInTheDocument()
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem', { name: /דן/ })).not.toBeInTheDocument()
  })
})
