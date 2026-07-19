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

export interface LetterAddress {
  email: string
  display_name: string
  contact_id?: number
}

export interface LetterIssueTag {
  id: number
  name: string
  slug: string
  createdAt: string
}

export type ChannelKind = 'email' | 'sms' | 'whatsapp'

export interface LetterChannel {
  id: number
  letterId: number
  kind: ChannelKind
  enabled: boolean
  recipientIds: number[]
  ccIds: number[]
  bccIds: number[]
  bodyText: string
  subject: string | null
  bodyHtml: string | null
  templateId: number | null
}

export interface LetterChannelInput {
  kind: ChannelKind
  enabled?: boolean
  recipientIds: number[]
  ccIds?: number[]
  bccIds?: number[]
  bodyText: string
  subject?: string | null
  bodyHtml?: string | null
  templateId?: number | null
}

export interface LetterContact {
  id: number
  displayName: string
  email: string | null
  phone: string | null
  hasWhatsapp: boolean
  photoUrl: string | null
  mkSiteId: number | null
  category: string
  createdAt: string
}

export interface LetterTemplate {
  id: number
  name: string
  html: string
  updatedAt: string
}

export interface LetterMediaAsset {
  id: number
  key: string
  url: string
  filename: string
  contentType: string
  sizeBytes: number
  uploadedBy: number | null
  createdAt: string
}

export interface Letter {
  id: number
  title: string
  /** Opaque key for the public share page (the share URL is built from this, not the id). */
  shareSlug: string
  channels: LetterChannel[]
  issueTagIds: number[]
  status: 'draft' | 'published'
  priority: 'normal' | 'high' | 'urgent'
  pinnedAt: string | null
  activityScore: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  /** Public R2 share-page URL, or null when no share page exists (draft / sharing off /
   *  R2 unconfigured). Optional because letters assembled internally (e.g. attachChannels)
   *  don't carry it — only the API responses attach it. */
  shareUrl?: string | null
}

export interface LetterWithStats extends Letter {
  totalSends: number
  breakdown: Record<string, number>
}

export interface RecipientSendLink {
  contactId: number
  displayName: string
  photoUrl: string | null
  url: string
}

export interface ChannelSend {
  kind: ChannelKind
  enabled: boolean
  bodyText: string
  unavailableCount: number
  // email only:
  mailtoUrl?: string
  gmailUrl?: string
  renderedHtml?: string
  // sms / whatsapp only:
  recipients?: RecipientSendLink[]
}

export interface LetterDetailResponse {
  letter: Letter
  channels: ChannelSend[]
}
