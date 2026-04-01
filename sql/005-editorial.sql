-- Editorial features: site angle, article angle, writing directives
ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS editorial_angle jsonb DEFAULT NULL;
ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS article_angle text DEFAULT NULL;
ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS writing_directives jsonb DEFAULT NULL;
