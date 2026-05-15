export interface SiteConfig {
  partyName: string;
  cellSubtitle: string;
  heroHeadline: string;
  heroTagline: string;
  logoPath: string;
  constitutionUrl: string;
  contactEmail: string;
}

export interface Bill {
  id: number;
  number: string;
  title: string;
  status: 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה';
  position: 'תומכים' | 'מתנגדים' | 'עוקבים';
  notes: string;
}

export interface Update {
  id: number;
  date: string;
  title: string;
  description: string;
}

export interface Protocol {
  id: number;
  date: string;
  title: string;
  attendees: string[];
  fileUrl: string;
}

export interface Representative {
  id: number;
  name: string;
  role: string;
  committee: string;
  initials: string;
}

export interface PrimariesCandidate {
  name: string;
  role: string;
  reason?: string;
}

export interface PrimariesCycle {
  cycle: string;
  current: boolean;
  candidates: PrimariesCandidate[];
}

export interface AboutData {
  paragraphs: string[];
  values: string[];
}
