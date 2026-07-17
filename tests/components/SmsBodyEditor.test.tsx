import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import SmsBodyEditor from '@/components/letters/SmsBodyEditor'

describe('SmsBodyEditor', () => {
  it('shows Hebrew UCS-2 segment info and flags over-limit', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<SmsBodyEditor value="" onChange={onChange} channelLabel="SMS" mode="sms" maxSegments={3} />)
    // 210 Hebrew chars = 4 segments (67/seg after the first) → over the 3-segment cap
    rerender(<SmsBodyEditor value={'ש'.repeat(210)} onChange={onChange} channelLabel="SMS" mode="sms" maxSegments={3} />)
    expect(screen.getByTestId('sms-encoding')).toHaveTextContent(/ucs2|UCS-2/i)
    expect(screen.getByTestId('sms-over-limit')).toBeInTheDocument()
  })

  it('emits typed text', async () => {
    const onChange = vi.fn()
    render(<SmsBodyEditor value="" onChange={onChange} channelLabel="SMS" mode="sms" />)
    await userEvent.type(screen.getByRole('textbox'), 'hi')
    expect(onChange).toHaveBeenCalled()
  })
})
