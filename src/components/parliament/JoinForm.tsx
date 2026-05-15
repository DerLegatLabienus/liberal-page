import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface FormData {
  name: string
  phone: string
  email: string
  idNumber: string
  neighborhood: string
}

const EMPTY: FormData = { name: '', phone: '', email: '', idNumber: '', neighborhood: '' }

export default function JoinForm() {
  const [form, setForm] = useState<FormData>(EMPTY)
  const [submitted, setSubmitted] = useState(false)

  const handleChange = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // BACKLOG: POST to /api/members/join when backend user storage is ready
    console.info('Join form submission (inactive):', form)
    setSubmitted(true)
  }

  if (submitted)
    return (
      <div className="rounded-lg bg-green-50 p-6 text-center text-green-700">
        <p className="font-semibold">תודה! נציג יצור איתך קשר בקרוב.</p>
      </div>
    )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input placeholder="שם מלא" required value={form.name} onChange={handleChange('name')} />
      <Input placeholder="טלפון" type="tel" required value={form.phone} onChange={handleChange('phone')} />
      <Input placeholder="אימייל" type="email" value={form.email} onChange={handleChange('email')} />
      <Input placeholder="מספר ת.ז." value={form.idNumber} onChange={handleChange('idNumber')} />
      <Input placeholder="שכונה / ישוב" value={form.neighborhood} onChange={handleChange('neighborhood')} />
      <Button type="submit" className="w-full">שלח</Button>
    </form>
  )
}
