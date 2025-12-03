// Scout execution edge function
// Handles individual scout execution - dispatched by pg_cron + pg_net
// Deploy with: npx supabase functions deploy scout-cron

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import type { Scout } from "./types.ts";
import { corsHeaders } from "./constants.ts";
import { executeScoutAgent } from "./agent.ts";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get scoutId from query params or body
    const url = new URL(req.url);
    let scoutId = url.searchParams.get("scoutId");

    // Also check request body for scoutId (pg_net sends it in body)
    if (!scoutId && req.method === "POST") {
      try {
        const body = await req.json();
        scoutId = body.scoutId;
      } catch {
        // Body parsing failed, continue with null scoutId
      }
    }

    if (!scoutId) {
      throw new Error("scoutId is required. This function executes individual scouts dispatched by pg_cron.");
    }

    console.log(`Executing scout: ${scoutId}`);

    // Fetch the scout
    const { data: scout, error: scoutError } = await supabase
      .from("scouts")
      .select("*")
      .eq("id", scoutId)
      .single();

    if (scoutError || !scout) {
      throw new Error(`Scout ${scoutId} not found in database`);
    }

    if (!scout.is_active) {
      throw new Error(`Scout ${scoutId} is not active`);
    }

    // Verify scout configuration is complete
    const isComplete =
      scout.title &&
      scout.goal &&
      scout.description &&
      scout.location &&
      scout.search_queries?.length > 0 &&
      scout.frequency;

    if (!isComplete) {
      throw new Error(`Scout ${scoutId} configuration is not complete`);
    }

    // Execute the scout
    await executeScoutAgent(scout as Scout, supabase);

    return new Response(
      JSON.stringify({
        success: true,
        scoutId: scout.id,
        title: scout.title,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in scout-cron:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
