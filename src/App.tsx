import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParliament } from '@/hooks/useParliament'
import { api } from '@/lib/api-client'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import ParliamentDrawer from '@/components/layout/ParliamentDrawer'
import HeroSection from '@/components/sections/HeroSection'
import ParliamentStrip from '@/components/sections/ParliamentStrip'
import AboutSection from '@/components/sections/AboutSection'
import LiberalsShowcase from '@/components/sections/LiberalsShowcase'
import GallerySection from '@/components/sections/GallerySection'
import FaqSection from '@/components/sections/FaqSection'
import JoinSection from '@/components/sections/JoinSection'

export default function App() {
  const { i18n } = useTranslation()
  const isHebrew = i18n.language === 'he'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { bills, committees, mks, loading, lastSyncedAt, refresh } = useParliament()

  const hasNewData =
    bills.some((b) => b.hasNewData) ||
    committees.some((c) => c.hasNewData) ||
    mks.some((m) => m.hasNewData)

  const handleOpenDrawer = useCallback(() => { if (isHebrew) setDrawerOpen(true) }, [isHebrew])
  const handleCloseDrawer = useCallback(() => setDrawerOpen(false), [])
  const handleAdd = useCallback(() => refresh(), [refresh])

  const handleRemoveBill = useCallback(async (id: number) => {
    await api.tracking.remove('bill', id)
    refresh()
  }, [refresh])

  const handleRemoveCommittee = useCallback(async (id: number) => {
    await api.tracking.remove('committee', id)
    refresh()
  }, [refresh])

  const handleRemoveMk = useCallback(async (id: number) => {
    await api.tracking.remove('mk', id)
    refresh()
  }, [refresh])

  return (
    <div className="min-h-screen bg-background">
      <Header
        hasNewParliamentData={hasNewData}
        onOpenDrawer={handleOpenDrawer}
        trackerEnabled={isHebrew}
      />
      <main>
        <HeroSection onOpenDrawer={handleOpenDrawer} trackerEnabled={isHebrew} />
        {isHebrew && (
          <ParliamentStrip bills={bills} committees={committees} onOpenDrawer={handleOpenDrawer} />
        )}
        <AboutSection />
        <LiberalsShowcase />
        <GallerySection />
        <FaqSection />
        <JoinSection />
      </main>
      <Footer />
      {isHebrew && (
        <ParliamentDrawer
          open={drawerOpen}
          onClose={handleCloseDrawer}
          bills={bills}
          committees={committees}
          mks={mks}
          loading={loading}
          lastSyncedAt={lastSyncedAt}
          onRefresh={refresh}
          onAdd={handleAdd}
          onRemoveBill={handleRemoveBill}
          onRemoveCommittee={handleRemoveCommittee}
          onRemoveMk={handleRemoveMk}
        />
      )}
    </div>
  )
}
