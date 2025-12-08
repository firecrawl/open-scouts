import { NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  supabaseServer,
} from "@/lib/supabase/server";

// Rate limiting constants
const MANUAL_RUN_COOLDOWN_MS = 20 * 60 * 1000; // 20 minutes between manual runs

export async function POST(req: Request) {
  try {
    // Get user session for authentication
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { scoutId } = await req.json();
    console.log("[scout/execute] Received scoutId:", scoutId);

    if (!scoutId) {
      return NextResponse.json(
        { error: "scoutId is required" },
        { status: 400 },
      );
    }

    // Verify user owns this scout
    const { data: scout, error: scoutError } = await supabaseServer
      .from("scouts")
      .select("user_id")
      .eq("id", scoutId)
      .single();

    if (scoutError || !scout || scout.user_id !== user.id) {
      return NextResponse.json(
        { error: "Scout not found or unauthorized" },
        { status: 403 },
      );
    }

    // Server-side rate limiting: Check for recent execution on this scout
    const { data: recentExecution } = await supabaseServer
      .from("scout_executions")
      .select("started_at")
      .eq("scout_id", scoutId)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (recentExecution) {
      const lastRunTime = new Date(recentExecution.started_at).getTime();
      const now = Date.now();
      const elapsed = now - lastRunTime;

      if (elapsed < MANUAL_RUN_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil(
          (MANUAL_RUN_COOLDOWN_MS - elapsed) / 1000,
        );
        console.log(
          `[scout/execute] Rate limited: ${remainingSeconds}s remaining for scout ${scoutId}`,
        );
        return NextResponse.json(
          {
            error: `Please wait ${Math.ceil(remainingSeconds / 60)} minutes before running this scout again`,
            cooldownRemaining: remainingSeconds,
          },
          { status: 429 },
        );
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[scout/execute] Supabase config missing");
      return NextResponse.json(
        { error: "Supabase configuration missing" },
        { status: 500 },
      );
    }

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/scout-cron?scoutId=${scoutId}`;
    console.log("[scout/execute] Triggering edge function:", edgeFunctionUrl);

    // Trigger the edge function asynchronously (fire-and-forget)
    // Don't await - let it run in the background
    fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
    }).catch((error) => {
      console.error("[scout/execute] Edge function trigger error:", error);
    });

    console.log("[scout/execute] Scout execution triggered successfully");

    // Return immediately - the client will receive updates via real-time subscriptions
    return NextResponse.json({
      success: true,
      message: "Scout execution triggered",
      scoutId,
    });
  } catch (error) {
    console.error("[scout/execute] Error triggering scout execution:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
