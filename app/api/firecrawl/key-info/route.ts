import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseServer } from "@/lib/supabase/server";

function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 6) return "•".repeat(key.length);
  return key.slice(0, 3) + "•".repeat(key.length - 6) + key.slice(-3);
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data } = await supabaseServer
      .from("user_preferences")
      .select(
        "firecrawl_api_key, firecrawl_key_status, firecrawl_key_created_at, firecrawl_key_error, firecrawl_custom_api_key, location",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      data: {
        status: data?.firecrawl_key_status ?? "pending",
        hasKey: !!data?.firecrawl_api_key,
        createdAt: data?.firecrawl_key_created_at ?? null,
        error: data?.firecrawl_key_error ?? null,
        hasCustomKey: !!data?.firecrawl_custom_api_key,
        customApiKeyMasked: maskKey(data?.firecrawl_custom_api_key),
        location: data?.location ?? null,
      },
    });
  } catch (error) {
    console.error("[Firecrawl Key Info] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
