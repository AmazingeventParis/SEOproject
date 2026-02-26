import { NextResponse } from "next/server";
import { Pool } from "pg";

const MIGRATION_SQL =
  "ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS title_suggestions jsonb DEFAULT NULL;";

// POST /api/migrate — Run pending schema migrations
// Tries multiple hostnames to find the Supabase DB container
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

  // Try multiple possible hostnames for the supabase-db container
  const customHost = process.env.POSTGRES_HOST;
  const hosts = [
    ...(customHost ? [customHost] : []),
    "supabase-db",
    "z4oc8k4k8o4wswkog084o0g4-supabase-db",
    "z4oc8k4k8o4wswkog084o0g4-supabase-db-1",
    "host.docker.internal",
  ];

  const errors: string[] = [];

  for (const host of hosts) {
    const pool = new Pool({
      host,
      port: 5432,
      user: "postgres",
      password: dbPassword,
      database: "postgres",
      ssl: false,
      connectionTimeoutMillis: 3000,
    });

    try {
      await pool.query(MIGRATION_SQL);
      await pool.end();
      return NextResponse.json({
        status: "ok",
        message: `Migration applied via ${host} — title_suggestions column added.`,
        host,
      });
    } catch (error) {
      await pool.end().catch(() => {});
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${host}: ${msg}`);
    }
  }

  return NextResponse.json(
    {
      status: "error",
      message: "Could not connect to PostgreSQL on any host",
      tried: errors,
      sql: MIGRATION_SQL,
    },
    { status: 500 }
  );
}
