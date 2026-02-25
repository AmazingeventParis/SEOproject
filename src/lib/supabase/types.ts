// ============================================================
// Supabase Database Types for SEO Tool
// Matches sql/001-schema.sql exactly
// ============================================================

// ---- Enum types ----

export type ArticleStatus =
  | 'draft'
  | 'analyzing'
  | 'planning'
  | 'writing'
  | 'media'
  | 'seo_check'
  | 'reviewing'
  | 'publishing'
  | 'published'
  | 'refresh_needed'

export type SearchIntent =
  | 'traffic'
  | 'review'
  | 'comparison'
  | 'discover'
  | 'lead_gen'
  | 'informational'

// ---- Internal link target (used in content blocks for strategic linking) ----

export interface InternalLinkTarget {
  target_slug: string
  target_title: string
  suggested_anchor_context: string
  is_money_page?: boolean
}

// ---- Content block (JSONB stored inside seo_articles.content_blocks) ----

export interface ContentBlock {
  id: string
  type: 'h2' | 'h3' | 'paragraph' | 'list' | 'faq' | 'callout' | 'image'
  heading?: string
  content_html: string
  nugget_ids: string[]
  word_count: number
  model_used?: string
  status: 'pending' | 'written' | 'approved'
  writing_directive?: string
  format_hint?: 'prose' | 'bullets' | 'table' | 'mixed'
  generate_image?: boolean
  image_prompt_hint?: string
  internal_link_targets?: InternalLinkTarget[]
}

// ---- Database type ----

export type Database = {
  public: {
    Tables: {
      seo_sites: {
        Row: {
          id: string
          name: string
          domain: string
          wp_url: string
          wp_user: string
          wp_app_password: string
          gsc_property: string | null
          niche: string | null
          default_persona_id: string | null
          money_page_url: string | null
          money_page_description: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          domain: string
          wp_url: string
          wp_user: string
          wp_app_password: string
          gsc_property?: string | null
          niche?: string | null
          default_persona_id?: string | null
          money_page_url?: string | null
          money_page_description?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          domain?: string
          wp_url?: string
          wp_user?: string
          wp_app_password?: string
          gsc_property?: string | null
          niche?: string | null
          default_persona_id?: string | null
          money_page_url?: string | null
          money_page_description?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'seo_sites_default_persona_id_fkey'
            columns: ['default_persona_id']
            isOneToOne: false
            referencedRelation: 'seo_personas'
            referencedColumns: ['id']
          }
        ]
      }

      seo_personas: {
        Row: {
          id: string
          site_id: string
          name: string
          role: string
          tone_description: string | null
          bio: string | null
          avatar_reference_url: string | null
          writing_style_examples: Record<string, unknown>[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          site_id: string
          name: string
          role: string
          tone_description?: string | null
          bio?: string | null
          avatar_reference_url?: string | null
          writing_style_examples?: Record<string, unknown>[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          site_id?: string
          name?: string
          role?: string
          tone_description?: string | null
          bio?: string | null
          avatar_reference_url?: string | null
          writing_style_examples?: Record<string, unknown>[]
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'seo_personas_site_id_fkey'
            columns: ['site_id']
            isOneToOne: false
            referencedRelation: 'seo_sites'
            referencedColumns: ['id']
          }
        ]
      }

      seo_nuggets: {
        Row: {
          id: string
          site_id: string | null
          persona_id: string | null
          content: string
          source_type: 'vocal' | 'tweet' | 'note' | 'url' | 'observation'
          source_ref: string | null
          tags: string[]
          created_at: string
        }
        Insert: {
          id?: string
          site_id?: string | null
          persona_id?: string | null
          content: string
          source_type: 'vocal' | 'tweet' | 'note' | 'url' | 'observation'
          source_ref?: string | null
          tags?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          site_id?: string | null
          persona_id?: string | null
          content?: string
          source_type?: 'vocal' | 'tweet' | 'note' | 'url' | 'observation'
          source_ref?: string | null
          tags?: string[]
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'seo_nuggets_site_id_fkey'
            columns: ['site_id']
            isOneToOne: false
            referencedRelation: 'seo_sites'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'seo_nuggets_persona_id_fkey'
            columns: ['persona_id']
            isOneToOne: false
            referencedRelation: 'seo_personas'
            referencedColumns: ['id']
          }
        ]
      }

      seo_silos: {
        Row: {
          id: string
          site_id: string
          name: string
          description: string | null
          pillar_article_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          site_id: string
          name: string
          description?: string | null
          pillar_article_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          site_id?: string
          name?: string
          description?: string | null
          pillar_article_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'seo_silos_site_id_fkey'
            columns: ['site_id']
            isOneToOne: false
            referencedRelation: 'seo_sites'
            referencedColumns: ['id']
          }
        ]
      }

      seo_articles: {
        Row: {
          id: string
          site_id: string
          silo_id: string | null
          persona_id: string | null
          keyword: string
          search_intent: SearchIntent
          status: ArticleStatus
          title: string | null
          slug: string | null
          meta_description: string | null
          content_blocks: ContentBlock[]
          content_html: string | null
          word_count: number
          wp_post_id: number | null
          wp_url: string | null
          json_ld: Record<string, unknown> | null
          serp_data: Record<string, unknown> | null
          nugget_density_score: number
          link_to_money_page: boolean
          created_at: string
          updated_at: string
          published_at: string | null
        }
        Insert: {
          id?: string
          site_id: string
          silo_id?: string | null
          persona_id?: string | null
          keyword: string
          search_intent?: SearchIntent
          status?: ArticleStatus
          title?: string | null
          slug?: string | null
          meta_description?: string | null
          content_blocks?: ContentBlock[]
          content_html?: string | null
          word_count?: number
          wp_post_id?: number | null
          wp_url?: string | null
          json_ld?: Record<string, unknown> | null
          serp_data?: Record<string, unknown> | null
          nugget_density_score?: number
          link_to_money_page?: boolean
          created_at?: string
          updated_at?: string
          published_at?: string | null
        }
        Update: {
          id?: string
          site_id?: string
          silo_id?: string | null
          persona_id?: string | null
          keyword?: string
          search_intent?: SearchIntent
          status?: ArticleStatus
          title?: string | null
          slug?: string | null
          meta_description?: string | null
          content_blocks?: ContentBlock[]
          content_html?: string | null
          word_count?: number
          wp_post_id?: number | null
          wp_url?: string | null
          json_ld?: Record<string, unknown> | null
          serp_data?: Record<string, unknown> | null
          nugget_density_score?: number
          link_to_money_page?: boolean
          created_at?: string
          updated_at?: string
          published_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'seo_articles_site_id_fkey'
            columns: ['site_id']
            isOneToOne: false
            referencedRelation: 'seo_sites'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'seo_articles_silo_id_fkey'
            columns: ['silo_id']
            isOneToOne: false
            referencedRelation: 'seo_silos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'seo_articles_persona_id_fkey'
            columns: ['persona_id']
            isOneToOne: false
            referencedRelation: 'seo_personas'
            referencedColumns: ['id']
          }
        ]
      }

      seo_article_nuggets: {
        Row: {
          article_id: string
          nugget_id: string
          block_index: number
        }
        Insert: {
          article_id: string
          nugget_id: string
          block_index: number
        }
        Update: {
          article_id?: string
          nugget_id?: string
          block_index?: number
        }
        Relationships: [
          {
            foreignKeyName: 'seo_article_nuggets_article_id_fkey'
            columns: ['article_id']
            isOneToOne: false
            referencedRelation: 'seo_articles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'seo_article_nuggets_nugget_id_fkey'
            columns: ['nugget_id']
            isOneToOne: false
            referencedRelation: 'seo_nuggets'
            referencedColumns: ['id']
          }
        ]
      }

      seo_silo_links: {
        Row: {
          id: string
          silo_id: string
          source_article_id: string
          target_article_id: string
          anchor_text: string
          is_bidirectional: boolean
          created_at: string
        }
        Insert: {
          id?: string
          silo_id: string
          source_article_id: string
          target_article_id: string
          anchor_text: string
          is_bidirectional?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          silo_id?: string
          source_article_id?: string
          target_article_id?: string
          anchor_text?: string
          is_bidirectional?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'seo_silo_links_silo_id_fkey'
            columns: ['silo_id']
            isOneToOne: false
            referencedRelation: 'seo_silos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'seo_silo_links_source_article_id_fkey'
            columns: ['source_article_id']
            isOneToOne: false
            referencedRelation: 'seo_articles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'seo_silo_links_target_article_id_fkey'
            columns: ['target_article_id']
            isOneToOne: false
            referencedRelation: 'seo_articles'
            referencedColumns: ['id']
          }
        ]
      }

      seo_pipeline_runs: {
        Row: {
          id: string
          article_id: string
          step: string
          status: 'running' | 'success' | 'error' | 'skipped'
          input: Record<string, unknown> | null
          output: Record<string, unknown> | null
          model_used: string | null
          tokens_in: number
          tokens_out: number
          cost_usd: number
          duration_ms: number
          error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          article_id: string
          step: string
          status?: 'running' | 'success' | 'error' | 'skipped'
          input?: Record<string, unknown> | null
          output?: Record<string, unknown> | null
          model_used?: string | null
          tokens_in?: number
          tokens_out?: number
          cost_usd?: number
          duration_ms?: number
          error?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          article_id?: string
          step?: string
          status?: 'running' | 'success' | 'error' | 'skipped'
          input?: Record<string, unknown> | null
          output?: Record<string, unknown> | null
          model_used?: string | null
          tokens_in?: number
          tokens_out?: number
          cost_usd?: number
          duration_ms?: number
          error?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'seo_pipeline_runs_article_id_fkey'
            columns: ['article_id']
            isOneToOne: false
            referencedRelation: 'seo_articles'
            referencedColumns: ['id']
          }
        ]
      }

      seo_discover_items: {
        Row: {
          id: string
          site_id: string
          topic: string
          source: 'twitter' | 'trends' | 'serp' | 'manual'
          raw_data: Record<string, unknown> | null
          status: 'new' | 'selected' | 'converted' | 'dismissed'
          article_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          site_id: string
          topic: string
          source: 'twitter' | 'trends' | 'serp' | 'manual'
          raw_data?: Record<string, unknown> | null
          status?: 'new' | 'selected' | 'converted' | 'dismissed'
          article_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          site_id?: string
          topic?: string
          source?: 'twitter' | 'trends' | 'serp' | 'manual'
          raw_data?: Record<string, unknown> | null
          status?: 'new' | 'selected' | 'converted' | 'dismissed'
          article_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'seo_discover_items_site_id_fkey'
            columns: ['site_id']
            isOneToOne: false
            referencedRelation: 'seo_sites'
            referencedColumns: ['id']
          }
        ]
      }

      seo_config: {
        Row: {
          key: string
          value: Record<string, unknown>
          updated_at: string
        }
        Insert: {
          key: string
          value: Record<string, unknown>
          updated_at?: string
        }
        Update: {
          key?: string
          value?: Record<string, unknown>
          updated_at?: string
        }
        Relationships: []
      }
    }

    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      seo_article_status: ArticleStatus
      seo_search_intent: SearchIntent
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ============================================================
// Convenience type aliases
// ============================================================

export type Site = Database['public']['Tables']['seo_sites']['Row']
export type SiteInsert = Database['public']['Tables']['seo_sites']['Insert']
export type SiteUpdate = Database['public']['Tables']['seo_sites']['Update']

export type Persona = Database['public']['Tables']['seo_personas']['Row']
export type PersonaInsert = Database['public']['Tables']['seo_personas']['Insert']
export type PersonaUpdate = Database['public']['Tables']['seo_personas']['Update']

export type Nugget = Database['public']['Tables']['seo_nuggets']['Row']
export type NuggetInsert = Database['public']['Tables']['seo_nuggets']['Insert']
export type NuggetUpdate = Database['public']['Tables']['seo_nuggets']['Update']

export type Silo = Database['public']['Tables']['seo_silos']['Row']
export type SiloInsert = Database['public']['Tables']['seo_silos']['Insert']
export type SiloUpdate = Database['public']['Tables']['seo_silos']['Update']

export type Article = Database['public']['Tables']['seo_articles']['Row']
export type ArticleInsert = Database['public']['Tables']['seo_articles']['Insert']
export type ArticleUpdate = Database['public']['Tables']['seo_articles']['Update']

export type ArticleNugget = Database['public']['Tables']['seo_article_nuggets']['Row']
export type SiloLink = Database['public']['Tables']['seo_silo_links']['Row']
export type PipelineRun = Database['public']['Tables']['seo_pipeline_runs']['Row']
export type DiscoverItem = Database['public']['Tables']['seo_discover_items']['Row']
export type DiscoverItemInsert = Database['public']['Tables']['seo_discover_items']['Insert']
export type DiscoverItemUpdate = Database['public']['Tables']['seo_discover_items']['Update']
export type Config = Database['public']['Tables']['seo_config']['Row']
