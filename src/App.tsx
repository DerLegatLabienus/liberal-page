import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from '@/pages/HomePage'

// HomePage is the landing route and stays eager. The off-home pages are lazy-loaded so the
// common (homepage) visitor doesn't download the constitution, letters, and admin pages up front.
const ConstitutionPage = lazy(() => import('@/pages/ConstitutionPage'))
const LettersPage = lazy(() => import('@/pages/LettersPage'))
const LetterDetailPage = lazy(() => import('@/pages/LetterDetailPage'))
const AdminLettersPage = lazy(() => import('@/pages/AdminLettersPage'))

export default function App() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/constitution" element={<ConstitutionPage />} />
        <Route path="/letters" element={<LettersPage />} />
        <Route path="/letters/:id" element={<LetterDetailPage />} />
        <Route path="/admin/letters" element={<AdminLettersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
