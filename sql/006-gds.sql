-- ============================================================
-- Migration 006 — GDS (GestionnaireDeSite) publication target
-- Colonnes additives uniquement — aucune colonne existante modifiée
-- ============================================================

-- Config de connexion GDS sur chaque site
ALTER TABLE seo_sites
  ADD COLUMN IF NOT EXISTS publication_target TEXT    NOT NULL DEFAULT 'wordpress',
  ADD COLUMN IF NOT EXISTS gds_url            TEXT,
  ADD COLUMN IF NOT EXISTS gds_api_token      TEXT,
  ADD COLUMN IF NOT EXISTS gds_author         TEXT    DEFAULT 'mathilde',
  ADD COLUMN IF NOT EXISTS gds_category_map   JSONB   DEFAULT '{}'::jsonb;

-- Tracking post-publication GDS sur chaque article
ALTER TABLE seo_articles
  ADD COLUMN IF NOT EXISTS gds_slug         TEXT,
  ADD COLUMN IF NOT EXISTS gds_url          TEXT,
  ADD COLUMN IF NOT EXISTS gds_published_at TIMESTAMPTZ;
