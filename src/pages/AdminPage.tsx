import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import PageSkeleton from '@/components/PageSkeleton'
import BackToHome from '@/components/BackToHome'
import InvitesSection from '@/components/admin/InvitesSection'
import UsersSection from '@/components/admin/UsersSection'
import EmailTemplatesSection from '@/components/admin/EmailTemplatesSection'
import JoinAnalyticsSection from '@/components/admin/JoinAnalyticsSection'
import FeatureFlagsSection from '@/components/admin/FeatureFlagsSection'

type Tab = 'invites' | 'users' | 'templates' | 'analytics' | 'flags'

const TABS: { key: Tab; label: string }[] = [
  { key: 'invites', label: 'Invites' },
  { key: 'users', label: 'Users' },
  { key: 'templates', label: 'Email Templates' },
  { key: 'analytics', label: 'Join Analytics' },
  { key: 'flags', label: 'Feature Flags' },
]

export default function AdminPage() {
  const { user, ready } = useAuth()
  const isAdmin = ready && user?.role === 'admin'
  const [tab, setTab] = useState<Tab>('invites')

  // Wait for session restore before deciding access — a fresh load / deep link starts with
  // user=null until the refresh token is exchanged, which would otherwise flash the denial.
  if (!ready) return <PageSkeleton className="pt-16" />
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center" dir="ltr">
        <p className="text-muted-foreground">You don't have access to this page.</p>
        <BackToHome />
      </div>
    )
  }

  return (
    // Admin UI is English-only; force LTR so it aligns correctly on the RTL (Hebrew) site.
    <div className="min-h-screen bg-background" dir="ltr">
      <header className="flex items-center gap-4 border-b border-border px-8 py-4">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">← Back to site</Link>
        <h1 className="text-xl font-semibold">Admin</h1>
      </header>

      <div className="mx-auto max-w-4xl px-8 py-6">
        <div className="mb-6 flex flex-wrap gap-2 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Only the active section mounts, so each fetches its own data lazily on demand. */}
        {tab === 'invites' && <InvitesSection />}
        {tab === 'users' && <UsersSection />}
        {tab === 'templates' && <EmailTemplatesSection />}
        {tab === 'analytics' && <JoinAnalyticsSection />}
        {tab === 'flags' && <FeatureFlagsSection />}
      </div>
    </div>
  )
}
