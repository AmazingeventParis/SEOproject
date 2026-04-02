-- Migration: Add banned_phrases to seo_personas
-- Stores phrases/expressions that the AI must NEVER use for this persona
-- Example: ["On va pas se mentir", "Le bon sens paysan"]

ALTER TABLE seo_personas
ADD COLUMN IF NOT EXISTS banned_phrases jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN seo_personas.banned_phrases IS 'JSON array of strings — expressions the AI must never use when writing as this persona';
