import { NextResponse } from "next/server";
import { Pool } from "pg";

const MIGRATION_SQL = `
-- 005-nuggets-multi-site: Add site_ids array for multi-site nuggets
ALTER TABLE seo_nuggets ADD COLUMN IF NOT EXISTS site_ids text[] DEFAULT ARRAY[]::text[];

-- Migrate existing site_id into site_ids for all nuggets that have a site_id
UPDATE seo_nuggets SET site_ids = ARRAY[site_id::text]
  WHERE site_id IS NOT NULL AND (site_ids IS NULL OR site_ids = ARRAY[]::text[]);
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
