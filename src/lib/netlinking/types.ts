export interface VendorKeyword {
  keyword: string
  position: number
  volume: number
  traffic: number
  traffic_percent: number
  url: string
}

export interface LinkScores {
  roi: number
  power: number
  keyword: number
  safety: number
  topical: number
  overall: number
}

export interface AnchorVariant {
  type: 'exact' | 'broad' | 'brand'
  text: string
  context_sentence: string
}

export interface GeneratedArticle {
  title: string
  content_html: string
  content_text?: string // Plain text version for copy-paste
  word_count: number
  anchors: AnchorVariant[]
  target_url: string
  target_keyword: string
}

export interface GuestPostLink {
  url: string
  anchorText: string
  type: 'target' | 'authority' // target = your backlink, authority = supporting link
}

export interface GuestPostConfig {
  vendorDomain: string
  vendorNiche: string | null
  targetKeyword: string
  siteDomain: string
  siteNiche: string
  links: GuestPostLink[] // 1-3 links to insert
  wordCount?: number // default 800
  anchorProfile?: { exact: number; broad: number; brand: number }
}

export interface GapAnalysis {
  summary: string
  strengths: string[]
  weaknesses: string[]
  priorities: string[]
  anchor_distribution: {
    exact: number
    broad: number
    brand: number
    naked_url: number
    generic: number
  } | null
}

export type LinkOpportunityStatus = 'new' | 'analyzed' | 'approved' | 'article_generated' | 'purchased' | 'published' | 'rejected'
export type LinkPurchaseStatus = 'ordered' | 'writing' | 'published' | 'verified' | 'lost'
export type AnchorType = 'exact' | 'broad' | 'brand' | 'naked_url' | 'generic'
