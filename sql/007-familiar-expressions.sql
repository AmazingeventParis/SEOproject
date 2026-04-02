-- Migration: Add familiar_expressions to seo_personas
-- Pool of familiar/colloquial expressions the persona would naturally use
-- Example: ["ca pique", "pas folichon", "galere", "on est d'accord"]

ALTER TABLE seo_personas
ADD COLUMN IF NOT EXISTS familiar_expressions jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN seo_personas.familiar_expressions IS 'JSON array of strings — colloquial expressions the persona naturally uses to humanize writing';
