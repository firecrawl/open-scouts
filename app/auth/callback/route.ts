import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseServer } from "@/lib/supabase/server";
import { createFirecrawlKeyForUser } from "@/lib/firecrawl-partner";
import { getPostHogClient } from "@/lib/posthog-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") || "/";
  const pendingQuery = searchParams.get("pendingQuery") || "";

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Get the authenticated user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.id && user?.email) {
        // Check if user already has a Firecrawl API key (custom or sponsored)
        const { data: preferences } = await supabaseServer
          .from("user_preferences")
          .select("firecrawl_api_key, firecrawl_key_status, firecrawl_custom_api_key")
          .eq("user_id", user.id)
          .maybeSingle();

        // Skip sponsored key creation if user has a custom key or active sponsored key
        const hasCustomKey = !!preferences?.firecrawl_custom_api_key;
        const hasActiveKey =
          hasCustomKey ||
          (preferences?.firecrawl_api_key &&
            preferences?.firecrawl_key_status === "active");

        // PostHog: Identify user and track Google OAuth login on server side (optional)
        const posthog = getPostHogClient();
        if (posthog) {
          const isNewUser = !hasActiveKey;

          posthog.identify({
            distinctId: user.id,
            properties: {
              email: user.email,
            },
          });

          posthog.capture({
            distinctId: user.id,
            event: isNewUser ? "user_signed_up" : "user_logged_in",
            properties: {
              method: "google",
              email: user.email,
              is_new_user: isNewUser,
            },
          });

          await posthog.shutdown();
        }

        if (!hasActiveKey) {
          try {
            await createFirecrawlKeyForUser(user.id, user.email);
          } catch (err) {
            console.error(
              "[Auth Callback] Failed to create Firecrawl key:",
              err,
            );
          }
        }
      }

      // If there's a pending query, redirect to home to process it
      if (pendingQuery) {
        return NextResponse.redirect(
          `${origin}/?pendingQuery=${encodeURIComponent(pendingQuery)}`,
        );
      }
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
