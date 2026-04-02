import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";

export async function GET() {
  const supabase = getServerClient();
  const { data, error } = await supabase
    .from("seo_config")
    .select("*")
    .order("key");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = getServerClient();

  let body: { key: string; value: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.key) {
    return NextResponse.json({ error: "key is required" }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("seo_config")
    .upsert({ key: body.key, value: body.value as Record<string, unknown> })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
