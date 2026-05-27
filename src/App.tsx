import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from '@/pages/HomePage'
import ConstitutionPage from '@/pages/ConstitutionPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/constitution" element={<ConstitutionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
