import { NextResponse } from "next/server";
import { Pool } from "pg";

const MIGRATION_SQL = `
-- 008-keyword-research: Keyword research table
CREATE TABLE IF NOT EXISTS seo_keyword_research (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  silo_id uuid REFERENCES seo_silos(id) ON DELETE SET NULL,
  keyword text NOT NULL,
  volume integer DEFAULT 0,
  difficulty integer DEFAULT 0,
  cpc numeric(10,2) DEFAULT 0,
  kgr numeric(10,4),
  search_intent text DEFAULT 'traffic',
  competition numeric(5,4),
  serp_results bigint,
  priority_score integer DEFAULT 0,
  current_position numeric(5,1),
  status text DEFAULT 'new' CHECK (status IN ('new', 'selected', 'assigned', 'done', 'dismissed')),
  source text DEFAULT 'manual' CHECK (source IN ('semrush', 'gsc', 'manual', 'ai', 'serper')),
  import_batch text,
  cannibalization_risk jsonb,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(site_id, keyword)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_kw_research_site ON seo_keyword_research(site_id);
CREATE INDEX IF NOT EXISTS idx_kw_research_silo ON seo_keyword_research(silo_id);
CREATE INDEX IF NOT EXISTS idx_kw_research_status ON seo_keyword_research(status);
CREATE INDEX IF NOT EXISTS idx_kw_research_priority ON seo_keyword_research(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_kw_research_keyword_trgm ON seo_keyword_research USING gin (keyword gin_trgm_ops);

-- 009-growth-phase: Add growth phase to sites
ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS growth_phase text DEFAULT 'sandbox' CHECK (growth_phase IN ('sandbox', 'authority', 'monetization'));
`;

export async function POST() {
  const dbPassword = process.env.POSTGRES_PASSWORD;

  if (!dbPassword) {
    return NextResponse.json(
      {
        status: "error",
        message: "POSTGRES_PASSWORD env var not set. Run the SQL manually in Supabase SQL Editor:",
        sql: MIGRATION_SQL,
      },
      { status: 500 }
    );
  }

  const host = process.env.POSTGRES_HOST || "supabase-db";
  const users = [
    { user: "supabase_admin", password: dbPassword },
    { user: "postgres", password: dbPassword },
  ];
  const errors: string[] = [];

  for (const { user, password } of users) {
    const pool = new Pool({
      host, port: 5432, user, password, database: "postgres", ssl: false, connectionTimeoutMillis: 3000,
    });

    try {
      await pool.query(MIGRATION_SQL);
      await pool.end();
      return NextResponse.json({
        status: "ok",
        message: `Migration applied as ${user}@${host} — seo_keyword_research table + growth_phase column created.`,
      });
    } catch (error) {
      await pool.end().catch(() => {});
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${user}@${host}: ${msg}`);
    }
  }

  return NextResponse.json(
    { status: "error", message: `All connection attempts failed`, errors, sql: MIGRATION_SQL },
    { status: 500 }
  );
}
