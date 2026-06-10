export interface SiteConfig {
  partyName: string
  cellSubtitle: string
  heroHeadline: string
  heroTagline: string
  logoPath: string
  constitutionUrl: string
  contactEmail: string
}

export interface Bill {
  id: number
  oknesset_id: string
  number: string
  title: string
  status: string // Hebrew status label from Knesset KNS_Status (full vocabulary)
  position: 'תומכים' | 'מתנגדים' | 'עוקבים'
  notes: string
  committee: string
  sourceUrl: string
  documentUrl: string | null
  knessetUrl?: string
  hasNewData: boolean
  lastPolledAt: string | null
  inactive?: boolean
}

export interface BillSearchResult {
  billId: number
  name: string
  knessetUrl: string
}

export interface CommitteeListItem {
  committeeId: number
  name: string
  knessetUrl: string
}

export interface CommitteeSession {
  sessionId: number
  date: string
  knessetNum: number
  title: string
  sessionUrl: string
  attendingSiteIds: string[]
  aiSummary?: string
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
  inactive?: boolean
  recentSessions?: CommitteeSession[]
}

export interface MkVote {
  date: string
  billTitle: string
  vote: 'בעד' | 'נגד' | 'נמנע' | 'נעדר'
}

export type MkActivityType = 'bill_initiated' | 'vote' | 'duty_change' | 'question'

export interface MkActivity {
  type: MkActivityType
  date: string
  title: string
  detail?: string
  sourceUrl?: string
}

export interface MkRole {
  positionId: number
  description: string
  committeeName?: string
  factionName?: string
  isCurrent: boolean
  startDate: string | null
}

export interface Mk {
  id: number
  oknesset_id: string
  knesset_site_id?: string
  name: string
  party: string
  email?: string | null
  photoUrl?: string | null
  currentRoles?: MkRole[]
  activity?: MkActivity[]
  recentVotes: MkVote[]
  votingSummary: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
  inactive?: boolean
}

export interface GalleryItem {
  id: number
  src: string
  srcFull?: string
  caption: string
  captionEn?: string
  date: string
}

export interface FaqItem {
  id: number
  question: string
  answer: string
}

export interface LeadershipMember {
  name: string
  role: string
  image: string
  nameEn?: string
  roleEn?: string
}

export interface AboutData {
  paragraphs: string[]
  values: string[]
  leadership?: LeadershipMember[]
}

export interface SummaryCache {
  [md5: string]: {
    summary: string
    createdAt: string
    sourceUrl: string
    attendees?: string[]
    derivedTitle?: string
  }
}

export type TrackingType = 'bill' | 'committee' | 'mk'

export interface ParsedUrl {
  type: TrackingType
  id: string
}

export interface KnessetMember {
  siteId: number
  name: string
  party: string
  photoUrl: string | null
  isLiberal: boolean
  isSupporter: boolean
}

export interface KnessetBillOverviewItem {
  billId: number
  title: string
  statusId: number
  status: string        // Hebrew label mapped from statusId; '' if unknown
  committee: string      // committee name; '' if not assigned or committees cache absent
  lastUpdatedDate: string
  summary: string        // SummaryLaw; may be ''
  knessetUrl: string
  reason?: string        // present only for curated trending items
}

export interface TrendingBillEntry {
  billId: number
  title: string
  reason: string
}

export interface FeatureFlag { enabled: boolean; value: string | null }
export type FeatureFlags = Record<string, FeatureFlag>
