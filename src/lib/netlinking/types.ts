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
  word_count: number
  anchors: AnchorVariant[]
  target_url: string
  target_keyword: string
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
