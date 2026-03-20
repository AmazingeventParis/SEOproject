import { NextResponse } from "next/server";
import { Pool } from "pg";

const MIGRATION_SQL = `
-- 004-products: Product comparison tables
CREATE TABLE IF NOT EXISTS seo_comparison_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES seo_articles(id) ON DELETE CASCADE,
  name text NOT NULL,
  unit text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_comparison_criteria_article_id ON seo_comparison_criteria(article_id);

CREATE TABLE IF NOT EXISTS seo_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES seo_articles(id) ON DELETE CASCADE,
  name text NOT NULL,
  brand text,
  price numeric(10,2),
  price_label text,
  image_url text,
  affiliate_url text,
  affiliate_enabled boolean DEFAULT false,
  rating numeric(3,1),
  rating_scale integer DEFAULT 10,
  verdict text,
  pros text[] DEFAULT ARRAY[]::text[],
  cons text[] DEFAULT ARRAY[]::text[],
  specs jsonb DEFAULT '[]'::jsonb,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_products_article_id ON seo_products(article_id);
`;

// POST /api/migrate — Run pending schema migrations
export async function POST() {
  const dbPassword = process.env.POSTGRES_PASSWORD;

  if (!dbPassword) {
    return NextResponse.json(
      {
        status: "error",
        message:
          "POSTGRES_PASSWORD env var not set. Run the SQL manually in Supabase SQL Editor:",
        sql: MIGRATION_SQL,
      },
      { status: 500 }
    );
  }

  const host = process.env.POSTGRES_HOST || "supabase-db";
  const errors: string[] = [];

  // Try with multiple user/password combinations
  const users = [
    { user: "supabase_admin", password: dbPassword },
    { user: "postgres", password: dbPassword },
  ];

  for (const { user, password } of users) {
    const pool = new Pool({
      host,
      port: 5432,
      user,
      password,
      database: "postgres",
      ssl: false,
      connectionTimeoutMillis: 3000,
    });

    try {
      await pool.query(MIGRATION_SQL);
      await pool.end();
      return NextResponse.json({
        status: "ok",
        message: `Migration applied as ${user}@${host} — title_suggestions + seo_title + authority_link + theme_color + year_tag + youtube source_type.`,
      });
    } catch (error) {
      await pool.end().catch(() => {});
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${user}@${host}: ${msg}`);
    }
  }

  return NextResponse.json(
    {
      status: "error",
      message: "Could not run migration",
      tried: errors,
      sql: MIGRATION_SQL,
    },
    { status: 500 }
  );
}
