import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Rate limit: 2 minutes between test emails
const TEST_EMAIL_COOLDOWN_MS = 2 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Check rate limit - get last test email time from user_preferences
    const { data: preferences } = await supabase
      .from("user_preferences")
      .select("last_test_email_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (preferences?.last_test_email_at) {
      const lastSentAt = new Date(preferences.last_test_email_at).getTime();
      const now = Date.now();
      const elapsed = now - lastSentAt;

      if (elapsed < TEST_EMAIL_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((TEST_EMAIL_COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json(
          {
            error: `Please wait ${remainingSeconds} seconds before sending another test email`,
            cooldownRemaining: remainingSeconds
          },
          { status: 429 }
        );
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Supabase configuration missing" },
        { status: 500 }
      );
    }

    // Call the edge function with the anon key
    const response = await fetch(`${supabaseUrl}/functions/v1/send-test-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: user.id }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to send test email" },
        { status: response.status }
      );
    }

    // Update last_test_email_at timestamp
    if (preferences) {
      await supabase
        .from("user_preferences")
        .update({ last_test_email_at: new Date().toISOString() })
        .eq("user_id", user.id);
    } else {
      // Create preferences row if it doesn't exist
      await supabase
        .from("user_preferences")
        .insert({
          user_id: user.id,
          last_test_email_at: new Date().toISOString()
        });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[send-test-email] Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
