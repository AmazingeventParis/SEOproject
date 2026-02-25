-- =============================================================================
-- SEO Content Production Tool - Database Schema
-- =============================================================================
-- Target: Supabase self-hosted (shared instance)
-- All tables prefixed with seo_ to avoid collisions
-- Execute in Supabase SQL Editor in a single transaction
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
CREATE TYPE seo_article_status AS ENUM (
  'draft',
  'analyzing',
  'planning',
  'writing',
  'media',
  'seo_check',
  'reviewing',
  'publishing',
  'published',
  'refresh_needed'
);

CREATE TYPE seo_search_intent AS ENUM (
  'traffic',
  'review',
  'comparison',
  'discover',
  'lead_gen',
  'informational'
);

-- ---------------------------------------------------------------------------
-- 1. seo_sites - WordPress site configuration
-- ---------------------------------------------------------------------------
CREATE TABLE seo_sites (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  domain             text        NOT NULL UNIQUE,
  wp_url             text        NOT NULL,
  wp_user            text        NOT NULL,
  wp_app_password    text        NOT NULL,
  gsc_property       text,
  niche              text,
  default_persona_id uuid,           -- FK added later (circular ref with seo_personas)
  active             boolean     DEFAULT true,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

COMMENT ON TABLE  seo_sites IS 'WordPress sites managed by the SEO tool';
COMMENT ON COLUMN seo_sites.wp_url IS 'WP REST API base URL, e.g. https://example.com/wp-json/wp/v2';
COMMENT ON COLUMN seo_sites.gsc_property IS 'Google Search Console property URL';
COMMENT ON COLUMN seo_sites.default_persona_id IS 'Default expert persona used when writing for this site';

-- ---------------------------------------------------------------------------
-- 2. seo_personas - Expert identity per site
-- ---------------------------------------------------------------------------
CREATE TABLE seo_personas (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 uuid        NOT NULL REFERENCES seo_sites (id) ON DELETE CASCADE,
  name                    text        NOT NULL,
  role                    text        NOT NULL,
  tone_description        text,
  bio                     text,
  avatar_reference_url    text,
  writing_style_examples  jsonb       DEFAULT '[]'::jsonb,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

COMMENT ON TABLE  seo_personas IS 'Expert identities used for E-E-A-T and consistent voice';
COMMENT ON COLUMN seo_personas.avatar_reference_url IS 'Consistent face reference image URL for Fal.ai generation';
COMMENT ON COLUMN seo_personas.writing_style_examples IS 'JSON array of example text snippets illustrating the persona voice';

-- ---------------------------------------------------------------------------
-- 3. seo_nuggets - Exclusive knowledge database
-- ---------------------------------------------------------------------------
CREATE TABLE seo_nuggets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid        REFERENCES seo_sites (id) ON DELETE SET NULL,
  persona_id  uuid        REFERENCES seo_personas (id) ON DELETE SET NULL,
  content     text        NOT NULL,
  source_type text        NOT NULL CHECK (source_type IN ('vocal', 'tweet', 'note', 'url', 'observation')),
  source_ref  text,
  tags        text[]      DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

COMMENT ON TABLE  seo_nuggets IS 'Exclusive knowledge pieces injected into articles for uniqueness';
COMMENT ON COLUMN seo_nuggets.site_id IS 'Nullable - nuggets can be cross-site';
COMMENT ON COLUMN seo_nuggets.source_type IS 'Origin of the nugget: vocal memo, tweet, note, URL scrape, or observation';

-- ---------------------------------------------------------------------------
-- 4. seo_silos - Content silo structures
-- ---------------------------------------------------------------------------
CREATE TABLE seo_silos (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid        NOT NULL REFERENCES seo_sites (id) ON DELETE CASCADE,
  name              text        NOT NULL,
  description       text,
  pillar_article_id uuid,           -- FK added later (circular ref with seo_articles)
  created_at        timestamptz DEFAULT now()
);

COMMENT ON TABLE  seo_silos IS 'Topic silos grouping related articles for internal linking';
COMMENT ON COLUMN seo_silos.pillar_article_id IS 'Main pillar/cornerstone article for this silo';

-- ---------------------------------------------------------------------------
-- 5. seo_articles - Main article table
-- ---------------------------------------------------------------------------
CREATE TABLE seo_articles (
  id                   uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid               NOT NULL REFERENCES seo_sites (id) ON DELETE CASCADE,
  silo_id              uuid               REFERENCES seo_silos (id) ON DELETE SET NULL,
  persona_id           uuid               REFERENCES seo_personas (id) ON DELETE SET NULL,
  keyword              text               NOT NULL,
  search_intent        seo_search_intent  NOT NULL DEFAULT 'traffic',
  status               seo_article_status NOT NULL DEFAULT 'draft',
  title                text,
  slug                 text,
  meta_description     text,
  content_blocks       jsonb              DEFAULT '[]'::jsonb,
  content_html         text,
  word_count           integer            DEFAULT 0,
  wp_post_id           integer,
  wp_url               text,
  json_ld              jsonb,
  serp_data            jsonb,
  nugget_density_score real               DEFAULT 0,
  created_at           timestamptz        DEFAULT now(),
  updated_at           timestamptz        DEFAULT now(),
  published_at         timestamptz
);

COMMENT ON TABLE  seo_articles IS 'SEO articles with full lifecycle from draft to published';
COMMENT ON COLUMN seo_articles.content_blocks IS 'JSON array of structured content blocks (H2, paragraph, list, etc.)';
COMMENT ON COLUMN seo_articles.serp_data IS 'Cached SERP analysis data for the target keyword';
COMMENT ON COLUMN seo_articles.nugget_density_score IS 'Ratio of nugget-enriched blocks to total blocks';

-- ---------------------------------------------------------------------------
-- 6. seo_article_nuggets - Junction table (article <-> nugget)
-- ---------------------------------------------------------------------------
CREATE TABLE seo_article_nuggets (
  article_id  uuid    NOT NULL REFERENCES seo_articles (id) ON DELETE CASCADE,
  nugget_id   uuid    NOT NULL REFERENCES seo_nuggets (id) ON DELETE CASCADE,
  block_index integer NOT NULL,
  PRIMARY KEY (article_id, nugget_id, block_index)
);

COMMENT ON TABLE seo_article_nuggets IS 'Maps which nuggets are used in which article content blocks';

-- ---------------------------------------------------------------------------
-- 7. seo_silo_links - Internal linking within silos
-- ---------------------------------------------------------------------------
CREATE TABLE seo_silo_links (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  silo_id           uuid        NOT NULL REFERENCES seo_silos (id) ON DELETE CASCADE,
  source_article_id uuid        NOT NULL REFERENCES seo_articles (id) ON DELETE CASCADE,
  target_article_id uuid        NOT NULL REFERENCES seo_articles (id) ON DELETE CASCADE,
  anchor_text       text        NOT NULL,
  is_bidirectional  boolean     DEFAULT false,
  created_at        timestamptz DEFAULT now()
);

COMMENT ON TABLE  seo_silo_links IS 'Internal links between articles within the same silo';
COMMENT ON COLUMN seo_silo_links.is_bidirectional IS 'If true, the link should be reciprocal';

-- ---------------------------------------------------------------------------
-- 8. seo_pipeline_runs - Pipeline execution log
-- ---------------------------------------------------------------------------
CREATE TABLE seo_pipeline_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  uuid        NOT NULL REFERENCES seo_articles (id) ON DELETE CASCADE,
  step        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'success', 'error', 'skipped')),
  input       jsonb,
  output      jsonb,
  model_used  text,
  tokens_in   integer     DEFAULT 0,
  tokens_out  integer     DEFAULT 0,
  cost_usd    real        DEFAULT 0,
  duration_ms integer     DEFAULT 0,
  error       text,
  created_at  timestamptz DEFAULT now()
);

COMMENT ON TABLE  seo_pipeline_runs IS 'Execution log for each pipeline step (analyze, plan, write, media, seo, publish)';
COMMENT ON COLUMN seo_pipeline_runs.step IS 'Pipeline step name: analyze, plan, write_block, media, seo, publish';

-- ---------------------------------------------------------------------------
-- 9. seo_discover_items - Trending topic monitoring
-- ---------------------------------------------------------------------------
CREATE TABLE seo_discover_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid        NOT NULL REFERENCES seo_sites (id) ON DELETE CASCADE,
  topic      text        NOT NULL,
  source     text        NOT NULL CHECK (source IN ('twitter', 'trends', 'serp', 'manual')),
  raw_data   jsonb,
  status     text        NOT NULL DEFAULT 'new'
                         CHECK (status IN ('new', 'selected', 'converted', 'dismissed')),
  article_id uuid        REFERENCES seo_articles (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE  seo_discover_items IS 'Trending topics discovered from various sources for content ideas';
COMMENT ON COLUMN seo_discover_items.article_id IS 'Set when a discover item is converted into an article';

-- ---------------------------------------------------------------------------
-- 10. seo_config - Global configuration key-value store
-- ---------------------------------------------------------------------------
CREATE TABLE seo_config (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE seo_config IS 'Global key-value configuration for the SEO tool';

-- =============================================================================
-- Deferred foreign keys (circular references)
-- =============================================================================

-- seo_sites.default_persona_id -> seo_personas
ALTER TABLE seo_sites
  ADD CONSTRAINT fk_sites_default_persona
  FOREIGN KEY (default_persona_id) REFERENCES seo_personas (id) ON DELETE SET NULL;

-- seo_silos.pillar_article_id -> seo_articles
ALTER TABLE seo_silos
  ADD CONSTRAINT fk_silos_pillar_article
  FOREIGN KEY (pillar_article_id) REFERENCES seo_articles (id) ON DELETE SET NULL;

-- =============================================================================
-- Indexes
-- =============================================================================

-- Articles: filter by site + status (dashboard queries)
CREATE INDEX idx_seo_articles_site_status
  ON seo_articles (site_id, status);

-- Articles: keyword search / uniqueness checks
CREATE INDEX idx_seo_articles_keyword
  ON seo_articles (keyword);

-- Articles: trigram index for keyword similarity (cannibalization check)
CREATE INDEX idx_seo_articles_keyword_trgm
  ON seo_articles USING gin (keyword gin_trgm_ops);

-- Nuggets: tag filtering
CREATE INDEX idx_seo_nuggets_tags
  ON seo_nuggets USING gin (tags);

-- Pipeline runs: fetch history for a given article
CREATE INDEX idx_seo_pipeline_runs_article_created
  ON seo_pipeline_runs (article_id, created_at);

-- =============================================================================
-- Updated_at trigger function
-- =============================================================================
CREATE OR REPLACE FUNCTION seo_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION seo_set_updated_at() IS 'Automatically sets updated_at to now() on every UPDATE';

-- Apply trigger to all tables that have an updated_at column
CREATE TRIGGER trg_seo_sites_updated_at
  BEFORE UPDATE ON seo_sites
  FOR EACH ROW EXECUTE FUNCTION seo_set_updated_at();

CREATE TRIGGER trg_seo_personas_updated_at
  BEFORE UPDATE ON seo_personas
  FOR EACH ROW EXECUTE FUNCTION seo_set_updated_at();

CREATE TRIGGER trg_seo_articles_updated_at
  BEFORE UPDATE ON seo_articles
  FOR EACH ROW EXECUTE FUNCTION seo_set_updated_at();

CREATE TRIGGER trg_seo_config_updated_at
  BEFORE UPDATE ON seo_config
  FOR EACH ROW EXECUTE FUNCTION seo_set_updated_at();

-- =============================================================================
-- Cannibalization check function
-- =============================================================================
-- Returns articles for a given site whose keyword is similar to the input,
-- ranked by trigram similarity score. Useful to detect keyword cannibalization.
-- =============================================================================
CREATE OR REPLACE FUNCTION seo_check_cannibalization(
  p_keyword text,
  p_site_id uuid
)
RETURNS TABLE (
  article_id uuid,
  keyword    text,
  title      text,
  status     seo_article_status,
  similarity real
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id          AS article_id,
    a.keyword     AS keyword,
    a.title       AS title,
    a.status      AS status,
    similarity(a.keyword, p_keyword) AS similarity
  FROM seo_articles a
  WHERE a.site_id = p_site_id
    AND similarity(a.keyword, p_keyword) > 0.3
  ORDER BY similarity(a.keyword, p_keyword) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION seo_check_cannibalization(text, uuid)
  IS 'Returns articles with similar keywords (trigram similarity > 0.3) to detect cannibalization';

-- =============================================================================
-- Default configuration values
-- =============================================================================
INSERT INTO seo_config (key, value) VALUES
  ('nugget_density_threshold', '3'::jsonb);

COMMIT;
