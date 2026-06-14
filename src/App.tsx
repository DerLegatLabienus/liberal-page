import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from '@/pages/HomePage'
import ConstitutionPage from '@/pages/ConstitutionPage'
import LettersPage from '@/pages/LettersPage'
import LetterDetailPage from '@/pages/LetterDetailPage'
import AdminLettersPage from '@/pages/AdminLettersPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/constitution" element={<ConstitutionPage />} />
      <Route path="/letters" element={<LettersPage />} />
      <Route path="/letters/:id" element={<LetterDetailPage />} />
      <Route path="/admin/letters" element={<AdminLettersPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
