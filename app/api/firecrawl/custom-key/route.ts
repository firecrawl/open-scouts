import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseServer } from "@/lib/supabase/server";

function maskKey(key: string): string {
  if (key.length <= 6) return "•".repeat(key.length);
  return key.slice(0, 3) + "•".repeat(key.length - 6) + key.slice(-3);
}

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function PUT(request: Request) {
  try {
    const userId = await getAuthedUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      apiKey?: unknown;
    };

    const raw = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!raw) {
      return NextResponse.json(
        { error: "apiKey is required" },
        { status: 400 },
      );
    }
    if (!raw.startsWith("fc-")) {
      return NextResponse.json(
        { error: "API key should start with 'fc-'" },
        { status: 400 },
      );
    }
    if (raw.length > 200) {
      return NextResponse.json(
        { error: "API key is too long" },
        { status: 400 },
      );
    }

    const { data: existing } = await supabaseServer
      .from("user_preferences")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    const updateData = {
      firecrawl_custom_api_key: raw,
      firecrawl_key_status: "active" as const,
    };

    if (existing) {
      const { error } = await supabaseServer
        .from("user_preferences")
        .update(updateData)
        .eq("user_id", userId);
      if (error) throw error;
    } else {
      const { error } = await supabaseServer
        .from("user_preferences")
        .insert({ user_id: userId, ...updateData });
      if (error) throw error;
    }

    return NextResponse.json({
      success: true,
      data: {
        hasCustomKey: true,
        customApiKeyMasked: maskKey(raw),
      },
    });
  } catch (error) {
    console.error("[Firecrawl Custom Key] PUT error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save API key",
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const userId = await getAuthedUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabaseServer
      .from("user_preferences")
      .update({ firecrawl_custom_api_key: null })
      .eq("user_id", userId);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: { hasCustomKey: false, customApiKeyMasked: null },
    });
  } catch (error) {
    console.error("[Firecrawl Custom Key] DELETE error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to remove API key",
      },
      { status: 500 },
    );
  }
}
