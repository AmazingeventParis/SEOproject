import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { SiteInsert } from "@/lib/supabase/types";

const createSiteSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  domain: z.string().min(1, "Le domaine est requis"),
  wp_url: z.string().url("L'URL WordPress doit etre valide"),
  wp_user: z.string().min(1, "L'utilisateur WordPress est requis"),
  wp_app_password: z.string().min(1, "Le mot de passe applicatif est requis"),
  gsc_property: z.string().nullable().optional(),
  niche: z.string().nullable().optional(),
  money_page_url: z.string().nullable().optional(),
  money_page_description: z.string().nullable().optional(),
});

// GET /api/sites - List all sites
export async function GET() {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("seo_sites")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

// POST /api/sites - Create a new site
export async function POST(request: NextRequest) {
  const supabase = getServerClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requete invalide" },
      { status: 400 }
    );
  }

  const parsed = createSiteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_sites")
    .insert(parsed.data as SiteInsert)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}
