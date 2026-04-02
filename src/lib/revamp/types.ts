// ============================================================
// Revamp Engine — Types
// Module for updating old WordPress articles with fresh content
// ============================================================

import type { ContentBlock } from '@/lib/supabase/types'

export type RevampStatus =
  | 'pending'        // Identified but not yet analyzed
  | 'analyzing'      // GSC + SERP analysis in progress
  | 'analyzed'       // Analysis complete, waiting for approval
  | 'approved'       // User approved the audit plan
  | 'generating'     // Content regeneration in progress
  | 'generated'      // New content ready for review
  | 'pushing'        // Pushing to WordPress
  | 'completed'      // Successfully pushed to WP
  | 'failed'         // Error during any step

export type PageBuilder = 'gutenberg' | 'elementor' | 'unknown'

export interface RevampGSCData {
  totalClicks: number
  totalImpressions: number
  avgCtr: number
  avgPosition: number
  topQueries: {
    query: string
    clicks: number
    impressions: number
    ctr: number
    position: number
  }[]
  opportunityKeywords: {
    query: string
    impressions: number
    position: number
    opportunityScore: number
  }[]
}

export interface RevampSERPComparison {
  competitors: {
    url: string
    title: string
    headings: string[]
    wordCount: number
    hasImages: boolean
    hasFaq: boolean
    hasTables: boolean
  }[]
  missingTopics: string[]
  outdatedSections: string[]
  strengthsToKeep: string[]
}

export interface RevampAudit {
  overallScore: number // 0-100
  blocksToKeep: {
    blockIndex: number
    heading: string | null
    reason: string
  }[]
  blocksToDelete: {
    blockIndex: number
    heading: string | null
    reason: string
  }[]
  blocksToRewrite: {
    blockIndex: number
    heading: string | null
    reason: string
    directive: string
  }[]
  newSectionsToAdd: {
    heading: string
    type: 'h2' | 'h3'
    insertAfterIndex: number // -1 = at the end
    directive: string
    keyIdeas: string[]
  }[]
  preservedLinks: {
    url: string
    anchorText: string
    isInternal: boolean
  }[]
  preservedCTAs: string[]
  suggestedTitle: string | null
  suggestedMetaDescription: string | null
}

// ---- Link suggestion types for revamp ----

export interface RevampAuthorityLinkSuggestion {
  url: string
  title: string
  domain: string
  snippet: string
  rationale: string
  is_valid: boolean
  selected: boolean
}

export interface RevampInternalLinkSuggestion {
  article_id: string | null  // null for WP-only posts
  wp_url: string
  title: string
  keyword: string
  anchor_text: string
  selected: boolean
}

export interface RevampLinkSuggestions {
  authority: RevampAuthorityLinkSuggestion[]
  internal: RevampInternalLinkSuggestion[]
  selectedAuthority: {
    url: string
    title: string
    anchor_context: string
  } | null
  customAuthorityUrl?: string // user-provided custom URL
}

export interface RevampProject {
  id: string
  site_id: string
  article_id: string | null // null if not imported in our DB yet
  wp_post_id: number
  wp_url: string
  original_title: string
  original_keyword: string
  page_builder: PageBuilder
  status: RevampStatus
  gsc_data: RevampGSCData | null
  serp_comparison: RevampSERPComparison | null
  audit: RevampAudit | null
  original_blocks: ContentBlock[] // Parsed from WP HTML
  new_blocks: ContentBlock[] | null // After regeneration
  new_content_html: string | null
  preserved_links: { url: string; anchor: string; isInternal: boolean }[]
  preserved_ctas: string[]
  link_suggestions: RevampLinkSuggestions | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface RevampCandidate {
  wpPostId: number
  wpUrl: string
  title: string
  slug: string
  publishedDate: string | null
  gscMetrics: {
    clicks: number
    impressions: number
    ctr: number
    position: number
  } | null
  daysSincePublished: number | null
  revampScore: number // Higher = more urgent to revamp
  pageBuilder: PageBuilder
  topKeywords: {
    query: string
    clicks: number
    impressions: number
    ctr: number
    position: number
  }[]
  bestKeyword: string | null
  searchIntent: string | null
  strengths: string[]
  weaknesses: string[]
}
