-- ============================================================
-- Revamp Engine — seo_revamps table
-- Stores revamp projects for updating old WordPress articles
-- ============================================================

CREATE TABLE IF NOT EXISTS seo_revamps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  article_id UUID REFERENCES seo_articles(id) ON DELETE SET NULL,
  wp_post_id INTEGER NOT NULL,
  wp_url TEXT NOT NULL DEFAULT '',
  original_title TEXT NOT NULL DEFAULT '',
  original_keyword TEXT NOT NULL DEFAULT '',
  page_builder TEXT NOT NULL DEFAULT 'unknown' CHECK (page_builder IN ('gutenberg', 'elementor', 'unknown')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'analyzed', 'approved', 'generating', 'generated', 'pushing', 'completed', 'failed')),
  gsc_data JSONB,
  serp_comparison JSONB,
  audit JSONB,
  original_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  new_blocks JSONB,
  new_content_html TEXT,
  preserved_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  preserved_ctas JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by site
CREATE INDEX IF NOT EXISTS idx_seo_revamps_site_id ON seo_revamps(site_id);

-- Index for checking existing revamps by wp_post_id
CREATE INDEX IF NOT EXISTS idx_seo_revamps_wp_post_id ON seo_revamps(wp_post_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_seo_revamps_status ON seo_revamps(status);
