export interface SiteConfig {
  partyName: string
  cellSubtitle: string
  heroHeadline: string
  heroTagline: string
  logoPath: string
  joinFormUrl: string
  constitutionUrl: string
  contactEmail: string
}

export interface Bill {
  id: number
  oknesset_id: string
  number: string
  title: string
  status: 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה'
  position: 'תומכים' | 'מתנגדים' | 'עוקבים'
  notes: string
  committee: string
  sourceUrl: string
  documentUrl: string | null
  hasNewData: boolean
  lastPolledAt: string | null
}

export interface Committee {
  id: number
  oknesset_id: string
  name: string
  chair: string
  lastSessionDate: string | null
  lastSessionSummary: string | null
  lastSessionDocumentUrl: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
}

export interface MkVote {
  date: string
  billTitle: string
  vote: 'בעד' | 'נגד' | 'נמנע' | 'נעדר'
}

export interface Mk {
  id: number
  oknesset_id: string
  name: string
  party: string
  recentVotes: MkVote[]
  votingSummary: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
}

export interface GalleryItem {
  id: number
  src: string
  caption: string
  date: string
}

export interface FaqItem {
  id: number
  question: string
  answer: string
}

export interface AboutData {
  paragraphs: string[]
  values: string[]
}

export interface SummaryCache {
  [md5: string]: {
    summary: string
    createdAt: string
    sourceUrl: string
  }
}

export type TrackingType = 'bill' | 'committee' | 'mk'

export interface ParsedUrl {
  type: TrackingType
  id: string
}
