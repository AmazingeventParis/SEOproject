-- 004-products.sql — Product comparison module for affiliation/comparison articles

-- Comparison criteria defined per article (shared across all products)
CREATE TABLE IF NOT EXISTS seo_comparison_criteria (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id    uuid NOT NULL REFERENCES seo_articles(id) ON DELETE CASCADE,
  name          text NOT NULL,
  unit          text,
  sort_order    integer DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_comparison_criteria_article_id ON seo_comparison_criteria(article_id);

-- Products linked to articles
CREATE TABLE IF NOT EXISTS seo_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id        uuid NOT NULL REFERENCES seo_articles(id) ON DELETE CASCADE,
  name              text NOT NULL,
  brand             text,
  price             numeric(10,2),
  price_label       text,
  image_url         text,
  affiliate_url     text,
  affiliate_enabled boolean DEFAULT false,
  rating            numeric(3,1),
  rating_scale      integer DEFAULT 10,
  verdict           text,
  pros              text[] DEFAULT '{}',
  cons              text[] DEFAULT '{}',
  specs             jsonb DEFAULT '[]',
  sort_order        integer DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_products_article_id ON seo_products(article_id);
