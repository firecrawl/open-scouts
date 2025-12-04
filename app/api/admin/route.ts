import { NextResponse } from "next/server";
import { createServerSupabaseClient, supabaseServer } from "@/lib/supabase/server";

// Admin email domain check
const ADMIN_EMAIL_DOMAIN = "@sideguide.dev";

export async function GET() {
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

    // Verify user has @sideguide.dev email
    if (!user.email?.endsWith(ADMIN_EMAIL_DOMAIN)) {
      return NextResponse.json(
        { error: "Unauthorized - Admin access required" },
        { status: 403 }
      );
    }

    // Get all users from auth.users via service role
    const { data: authUsers, error: usersError } = await supabaseServer.auth.admin.listUsers();

    if (usersError) {
      console.error("Error fetching users:", usersError);
      return NextResponse.json(
        { error: "Failed to fetch users" },
        { status: 500 }
      );
    }

    // Get scout counts per user
    const { data: scoutCounts, error: scoutError } = await supabaseServer
      .from("scouts")
      .select("user_id");

    if (scoutError) {
      console.error("Error fetching scouts:", scoutError);
    }

    // Get execution counts per user (via scouts)
    const { data: executions, error: execError } = await supabaseServer
      .from("scout_executions")
      .select("scout_id, status, scouts!inner(user_id)");

    if (execError) {
      console.error("Error fetching executions:", execError);
    }

    // Get user preferences for additional data
    const { data: preferences, error: prefError } = await supabaseServer
      .from("user_preferences")
      .select("user_id, firecrawl_key_status, location");

    if (prefError) {
      console.error("Error fetching preferences:", prefError);
    }

    // Build a map of user stats
    const userStatsMap = new Map<string, {
      scoutCount: number;
      executionCount: number;
      completedExecutions: number;
      failedExecutions: number;
      firecrawlStatus: string | null;
      hasLocation: boolean;
    }>();

    // Count scouts per user
    if (scoutCounts) {
      for (const scout of scoutCounts) {
        const userId = scout.user_id;
        if (!userStatsMap.has(userId)) {
          userStatsMap.set(userId, {
            scoutCount: 0,
            executionCount: 0,
            completedExecutions: 0,
            failedExecutions: 0,
            firecrawlStatus: null,
            hasLocation: false,
          });
        }
        userStatsMap.get(userId)!.scoutCount++;
      }
    }

    // Count executions per user
    if (executions) {
      for (const exec of executions) {
        const userId = (exec.scouts as any)?.user_id;
        if (userId) {
          if (!userStatsMap.has(userId)) {
            userStatsMap.set(userId, {
              scoutCount: 0,
              executionCount: 0,
              completedExecutions: 0,
              failedExecutions: 0,
              firecrawlStatus: null,
              hasLocation: false,
            });
          }
          const stats = userStatsMap.get(userId)!;
          stats.executionCount++;
          if (exec.status === "completed") {
            stats.completedExecutions++;
          } else if (exec.status === "failed") {
            stats.failedExecutions++;
          }
        }
      }
    }

    // Add preferences data
    if (preferences) {
      for (const pref of preferences) {
        if (!userStatsMap.has(pref.user_id)) {
          userStatsMap.set(pref.user_id, {
            scoutCount: 0,
            executionCount: 0,
            completedExecutions: 0,
            failedExecutions: 0,
            firecrawlStatus: null,
            hasLocation: false,
          });
        }
        const stats = userStatsMap.get(pref.user_id)!;
        stats.firecrawlStatus = pref.firecrawl_key_status;
        stats.hasLocation = !!pref.location;
      }
    }

    // Build the response data
    const users = authUsers.users.map((authUser) => {
      const stats = userStatsMap.get(authUser.id) || {
        scoutCount: 0,
        executionCount: 0,
        completedExecutions: 0,
        failedExecutions: 0,
        firecrawlStatus: null,
        hasLocation: false,
      };

      return {
        id: authUser.id,
        email: authUser.email,
        createdAt: authUser.created_at,
        lastSignIn: authUser.last_sign_in_at,
        emailConfirmed: !!authUser.email_confirmed_at,
        scoutCount: stats.scoutCount,
        executionCount: stats.executionCount,
        completedExecutions: stats.completedExecutions,
        failedExecutions: stats.failedExecutions,
        firecrawlStatus: stats.firecrawlStatus,
        hasLocation: stats.hasLocation,
      };
    });

    // Sort by creation date (newest first)
    users.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      users,
      totalUsers: users.length,
      totalScouts: scoutCounts?.length || 0,
      totalExecutions: executions?.length || 0,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[admin] Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
