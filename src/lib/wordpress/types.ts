// WordPress REST API type definitions

export interface WPPost {
  id: number
  date: string
  date_gmt: string
  slug: string
  status: 'publish' | 'draft' | 'pending' | 'private'
  title: { rendered: string }
  content: { rendered: string }
  excerpt: { rendered: string }
  link: string
  featured_media: number
  categories: number[]
  tags: number[]
}

export interface WPMedia {
  id: number
  date: string
  slug: string
  source_url: string
  alt_text: string
  media_details: {
    width: number
    height: number
    sizes: Record<string, { source_url: string; width: number; height: number }>
  }
}

export interface WPCategory {
  id: number
  name: string
  slug: string
  description: string
  count: number
  parent: number
}

export interface WPCreatePostInput {
  title: string
  content: string
  slug: string
  status: 'publish' | 'draft'
  categories?: number[]
  tags?: number[]
  featured_media?: number
  meta?: Record<string, unknown>
}

export interface WPUpdatePostInput {
  title?: string
  content?: string
  slug?: string
  status?: 'publish' | 'draft'
  categories?: number[]
  tags?: number[]
  featured_media?: number
}

export interface WPUploadMediaInput {
  buffer: Buffer
  filename: string
  altText: string
  mimeType?: string
}
