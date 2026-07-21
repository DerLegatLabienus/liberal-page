import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from '@/pages/HomePage'
import PageSkeleton from '@/components/PageSkeleton'

// HomePage is the landing route and stays eager. The off-home pages are lazy-loaded so the
// common (homepage) visitor doesn't download the constitution, letters, and admin pages up front.
const ConstitutionPage = lazy(() => import('@/pages/ConstitutionPage'))
const LettersPage = lazy(() => import('@/pages/LettersPage'))
const LetterDetailPage = lazy(() => import('@/pages/LetterDetailPage'))
const AdminPage = lazy(() => import('@/pages/AdminPage'))
const AdminLettersPage = lazy(() => import('@/pages/AdminLettersPage'))
const MagicLinkPage = lazy(() => import('@/pages/MagicLinkPage'))

export default function App() {
  return (
    <Suspense fallback={<PageSkeleton className="pt-16" />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/constitution" element={<ConstitutionPage />} />
        <Route path="/letters" element={<LettersPage />} />
        <Route path="/letters/:id" element={<LetterDetailPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/letters/manage" element={<AdminLettersPage />} />
        {/* Letters management moved out of /admin into the Letters section — keep old links working. */}
        <Route path="/admin/letters" element={<Navigate to="/letters/manage" replace />} />
        <Route path="/auth/magic-link" element={<MagicLinkPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
