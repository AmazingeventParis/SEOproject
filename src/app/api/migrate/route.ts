import { NextResponse } from "next/server";
import { Pool } from "pg";

// POST /api/migrate — Run pending schema migrations
// Connects directly to PostgreSQL to run DDL statements
// Safe to call multiple times (idempotent via IF NOT EXISTS)
export async function POST() {
  const dbHost = process.env.POSTGRES_HOST || "supabase-db";
  const dbPort = parseInt(process.env.POSTGRES_PORT || "5432");
  const dbPassword = process.env.POSTGRES_PASSWORD;

  if (!dbPassword) {
    return NextResponse.json(
      {
        status: "error",
        message:
          "POSTGRES_PASSWORD env var not set. Add it to Coolify env vars, or run the SQL manually in Supabase SQL Editor:",
        sql: "ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS title_suggestions jsonb DEFAULT NULL;",
      },
      { status: 500 }
    );
  }

  const pool = new Pool({
    host: dbHost,
    port: dbPort,
    user: "postgres",
    password: dbPassword,
    database: "postgres",
    ssl: false,
    connectionTimeoutMillis: 5000,
  });

  try {
    await pool.query(
      "ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS title_suggestions jsonb DEFAULT NULL;"
    );
    await pool.end();

    return NextResponse.json({
      status: "ok",
      message: "Migration applied — title_suggestions column added.",
    });
  } catch (error) {
    await pool.end().catch(() => {});
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        status: "error",
        message: `Migration failed: ${msg}`,
        sql: "ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS title_suggestions jsonb DEFAULT NULL;",
      },
      { status: 500 }
    );
  }
}
