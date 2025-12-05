import { NextResponse } from "next/server";
import { createServerSupabaseClient, supabaseServer } from "@/lib/supabase/server";

// Admin email domain check
const ADMIN_EMAIL_DOMAIN = "@sideguide.dev";

// Helper to verify admin access
async function verifyAdminAccess() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Not authenticated", status: 401 };
  }

  if (!user.email?.endsWith(ADMIN_EMAIL_DOMAIN)) {
    return { error: "Unauthorized - Admin access required", status: 403 };
  }

  return { user };
}

export async function GET() {
  try {
    // Verify admin access
    const authResult = await verifyAdminAccess();
    if ("error" in authResult) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
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

// DELETE - Delete a user and all their data
export async function DELETE(req: Request) {
  try {
    // Verify admin access
    const authResult = await verifyAdminAccess();
    if ("error" in authResult) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }

    const adminUser = authResult.user;
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Prevent admin from deleting themselves
    if (userId === adminUser.id) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    console.log(`[admin] Deleting user ${userId}...`);

    // Get user info before deletion for logging
    const { data: targetUser } = await supabaseServer.auth.admin.getUserById(userId);
    const userEmail = targetUser?.user?.email || "unknown";

    // Delete from auth.users - this will CASCADE to:
    // - scouts (ON DELETE CASCADE)
    //   - scout_messages (ON DELETE CASCADE from scouts)
    //   - scout_executions (ON DELETE CASCADE from scouts)
    //     - scout_execution_steps (ON DELETE CASCADE from scout_executions)
    // - user_preferences (ON DELETE CASCADE)
    // - firecrawl_usage_logs (ON DELETE CASCADE)
    const { error: deleteError } = await supabaseServer.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error(`[admin] Error deleting user ${userId}:`, deleteError);
      return NextResponse.json(
        { error: `Failed to delete user: ${deleteError.message}` },
        { status: 500 }
      );
    }

    console.log(`[admin] Successfully deleted user ${userEmail} (${userId})`);

    return NextResponse.json({
      success: true,
      message: `User ${userEmail} has been deleted`,
      deletedUserId: userId,
    });
  } catch (error: any) {
    console.error("[admin] Delete error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
