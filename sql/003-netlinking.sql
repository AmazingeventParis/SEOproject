BEGIN;

CREATE TABLE seo_link_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  tf          INTEGER DEFAULT 0,
  cf          INTEGER DEFAULT 0,
  da          INTEGER DEFAULT 0,
  dr          INTEGER DEFAULT 0,
  referring_domains INTEGER DEFAULT 0,
  total_backlinks   INTEGER DEFAULT 0,
  organic_traffic   INTEGER DEFAULT 0,
  organic_keywords  INTEGER DEFAULT 0,
  notes       TEXT,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_seo_link_profiles_site ON seo_link_profiles(site_id, snapshot_date DESC);
CREATE TRIGGER trg_seo_link_profiles_updated_at BEFORE UPDATE ON seo_link_profiles FOR EACH ROW EXECUTE FUNCTION seo_set_updated_at();

CREATE TABLE seo_link_opportunities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  vendor_domain   TEXT NOT NULL,
  vendor_url      TEXT,
  tf              INTEGER DEFAULT 0,
  cf              INTEGER DEFAULT 0,
  da              INTEGER DEFAULT 0,
  dr              INTEGER DEFAULT 0,
  organic_traffic INTEGER DEFAULT 0,
  price           REAL DEFAULT 0,
  target_page     TEXT,
  target_keyword  TEXT,
  niche           TEXT,
  language        TEXT DEFAULT 'fr',
  roi_score             REAL DEFAULT 0,
  power_score           REAL DEFAULT 0,
  keyword_score         REAL DEFAULT 0,
  safety_score          REAL DEFAULT 0,
  topical_relevance     REAL DEFAULT 0,
  overall_score         REAL DEFAULT 0,
  vendor_keywords       JSONB DEFAULT '[]'::jsonb,
  ai_analysis           JSONB,
  anchor_suggestions    JSONB,
  generated_article     JSONB,
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'analyzed', 'approved', 'article_generated', 'purchased', 'published', 'rejected')),
  purchased_at    TIMESTAMPTZ,
  published_url   TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_seo_link_opportunities_site ON seo_link_opportunities(site_id);
CREATE INDEX idx_seo_link_opportunities_status ON seo_link_opportunities(status);
CREATE INDEX idx_seo_link_opportunities_score ON seo_link_opportunities(overall_score DESC);
CREATE TRIGGER trg_seo_link_opportunities_updated_at BEFORE UPDATE ON seo_link_opportunities FOR EACH ROW EXECUTE FUNCTION seo_set_updated_at();

CREATE TABLE seo_link_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID REFERENCES seo_link_opportunities(id) ON DELETE SET NULL,
  site_id         UUID NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  vendor_domain   TEXT NOT NULL,
  price_paid      REAL NOT NULL DEFAULT 0,
  currency        TEXT DEFAULT 'EUR',
  target_page     TEXT,
  anchor_text     TEXT,
  anchor_type     TEXT CHECK (anchor_type IN ('exact', 'broad', 'brand', 'naked_url', 'generic')),
  published_url   TEXT,
  do_follow       BOOLEAN DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'ordered'
                  CHECK (status IN ('ordered', 'writing', 'published', 'verified', 'lost')),
  ordered_at      TIMESTAMPTZ DEFAULT now(),
  published_at    TIMESTAMPTZ,
  verified_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_seo_link_purchases_site ON seo_link_purchases(site_id);
CREATE INDEX idx_seo_link_purchases_opp ON seo_link_purchases(opportunity_id);
CREATE TRIGGER trg_seo_link_purchases_updated_at BEFORE UPDATE ON seo_link_purchases FOR EACH ROW EXECUTE FUNCTION seo_set_updated_at();

COMMIT;
