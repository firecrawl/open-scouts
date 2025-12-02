import { streamText, UIMessage, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  supabaseServer,
  createServerSupabaseClient,
} from "@/lib/supabase/server";
import { z } from "zod";

export const maxDuration = 300;

type Location = {
  city: string;
  latitude: number;
  longitude: number;
};

export async function POST(req: Request) {
  // Get user session for authentication
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse request body with error handling
  let body: {
    messages: UIMessage[];
    scoutId: string;
    location: Location | null;
  };

  try {
    body = await req.json();
  } catch (e) {
    console.error("Failed to parse request body:", e);
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, scoutId, location } = body;

  // Verify user owns this scout
  const { data: scout, error: scoutError } = await supabaseServer
    .from("scouts")
    .select("user_id")
    .eq("id", scoutId)
    .single();

  if (scoutError || !scout || scout.user_id !== user.id) {
    return new Response(
      JSON.stringify({ error: "Scout not found or unauthorized" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Save user message to database
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === "user") {
      // Extract text from UIMessage parts
      const textParts = lastMessage.parts.filter(
        (part) => part.type === "text",
      );
      const content = textParts.map((part) => part.text).join("\n");

      if (content) {
        await supabaseServer.from("scout_messages").insert({
          scout_id: scoutId,
          role: "user",
          content,
        });
      }
    }
  }

  // Get current scout data
  const { data: scoutData } = await supabaseServer
    .from("scouts")
    .select("*")
    .eq("id", scoutId)
    .single();

  const currentScout = scoutData || {};

  // Create system prompt for continuous configuration
  const systemPrompt = `You are an intelligent assistant that helps users create "Scouts" - automated monitoring and search tasks.

**User's Detected Location:** ${location ? `${location.city} (${location.latitude}, ${location.longitude})` : "Not available"}

**Current Scout Status:**
${currentScout.title ? `- Title: ${currentScout.title}` : "- Title: Not set"}
${currentScout.goal ? `- Goal: ${currentScout.goal}` : "- Goal: Not set"}
${currentScout.description ? `- Description: ${currentScout.description}` : "- Description: Not set"}
${currentScout.location ? `- Location: ${currentScout.location.city}` : "- Location: Not set"}
${currentScout.search_queries?.length > 0 ? `- Search Queries: ${JSON.stringify(currentScout.search_queries)}` : "- Search Queries: Not set"}
${currentScout.frequency ? `- Frequency: ${currentScout.frequency}` : "- Frequency: Not set"}

**CRITICAL RULES:**

1. **UPDATE SCOUT IMMEDIATELY:**
   - INSTANTLY call update_scout_config as soon as you understand what the user wants
   - DO NOT ask for confirmation before updating - just do it
   - From ANY request, you MUST immediately update ALL of these fields:
     * title: Short 2-4 word name (e.g., "AI News", "Coffee Shops SF")
     * goal: What they want to track (e.g., "Track new AI news and developments")
     * description: Detailed explanation (e.g., "Monitor and alert about new artificial intelligence news, breakthroughs, and developments")
     * search_queries: 3-5 diverse search terms to maximize coverage (e.g., ["AI news", "artificial intelligence news", "AI developments"])
   - These 4 fields can ALWAYS be inferred from the user's request - fill them ALL in your first tool call
   - ONLY ask the user for location (if not inferable) and frequency
   - NEVER set is_active to true - only the user can activate via the UI button

2. **DON'T BE REDUNDANT:**
   - The UI shows a checklist of what's been filled in - you don't need to repeat this
   - DO NOT list what you've saved or configured
   - ONLY ask for missing information that you cannot infer
   - Keep responses SHORT and focused on getting missing info

3. **LOCATION HANDLING:**
   - **DEFAULT to "any" for non-location-specific topics** (news, trends, tech updates, etc.)
   - **ONLY use detected location if user explicitly mentions**: "near me", "in my area", "in my town", "in my city", "locally", etc.
   - Examples:
     * "Find recent AI news" → INSTANTLY set location to {city: "any", latitude: 0, longitude: 0}
     * "Track tech trends" → INSTANTLY set location to {city: "any", latitude: 0, longitude: 0}
     * "Alert me about new restaurants" → ASK: "Where should I monitor? (You can say 'anywhere' or 'any' for global searches)"
     * "Alert me about new restaurants near me" → INSTANTLY use detected location
     * "Alert me about new restaurants in SF" → INSTANTLY use San Francisco
     * "Alert me about restaurants anywhere" → INSTANTLY set location to {city: "any", latitude: 0, longitude: 0}
   - **Never assume detected location should be used** unless explicitly requested
   - If user says "anywhere", "any", "globally", or similar → use {city: "any", latitude: 0, longitude: 0}

4. **TITLE MUST BE SHORT:**
   - Title: 2-4 words MAX, describing what's being tracked
   - ✅ "New Restaurants", "Indian Restaurants", "Pizza SF", "Coffee Shops"
   - ❌ "Alert me whenever a new restaurant opens up"
   - Extract the core subject, remove filler words

5. **EXAMPLE FLOW:**
   User: "Alert me about new Indian restaurants"
   AI: [INSTANTLY calls update_scout_config with:
        title: "Indian Restaurants",
        goal: "Track new Indian restaurant openings",
        description: "Monitor and alert about new Indian restaurants opening in the area",
        search_queries: ["new Indian restaurants", "Indian restaurant openings", "Indian cuisine", "Indian food", "Indian dining"]
       ] "Where should I monitor?"
   User: "San Francisco"
   AI: [calls update_scout_config with location] "How often - hourly, every 3 days, or weekly?"
   User: "Every 3 days"
   AI: [calls update_scout_config with frequency] "Done! Click the green button to activate."

6. **BE CONCISE:**
   - Short, direct questions for missing info
   - No need to confirm what you saved (the UI shows it)
   - Just ask for what's needed next

7. **Frequency Options:**
   - "hourly" - Every hour
   - "every_3_days" - Every 3 days
   - "weekly" - Once per week
   - "any" - For non-location-specific topics

Be conversational and helpful. When scout is complete, tell user they can modify anything by chatting with you. Never use em dashes (—)`;

  const result = streamText({
    model: openai("gpt-5-mini"),
    messages: convertToModelMessages(messages),
    system: systemPrompt,
    toolChoice: "auto",
    stopWhen: stepCountIs(5),
    tools: {
      update_scout_config: {
        description:
          "Update the scout configuration with new information gathered from the user",
        inputSchema: z.object({
          title: z
            .string()
            .optional()
            .describe("A short, descriptive name for the scout"),
          goal: z
            .string()
            .optional()
            .describe("What the scout is trying to monitor or find"),
          description: z
            .string()
            .optional()
            .describe("A detailed explanation of what this scout does"),
          location: z
            .object({
              city: z.string(),
              latitude: z.number(),
              longitude: z.number(),
            })
            .optional()
            .describe("The geographic location for the scout"),
          search_queries: z
            .array(z.string())
            .max(5)
            .optional()
            .describe("3-5 diverse search terms to maximize coverage (max 5)"),
          frequency: z
            .enum(["hourly", "every_3_days", "weekly"])
            .optional()
            .describe("How often the scout should run"),
        }),
        execute: async (params: {
          title?: string;
          goal?: string;
          description?: string;
          location?: { city: string; latitude: number; longitude: number };
          search_queries?: string[];
          frequency?: "hourly" | "every_3_days" | "weekly";
        }) => {
          // Update the scout with the new information
          const { error } = await supabaseServer
            .from("scouts")
            .update(params)
            .eq("id", scoutId);

          if (error) {
            return { success: false, error: error.message };
          }

          // After update, check if scout is complete
          const { data: updatedScout } = await supabaseServer
            .from("scouts")
            .select("*")
            .eq("id", scoutId)
            .single();

          if (updatedScout) {
            const isComplete =
              updatedScout.title &&
              updatedScout.goal &&
              updatedScout.description &&
              updatedScout.location &&
              updatedScout.search_queries?.length > 0 &&
              updatedScout.frequency;

            // Don't auto-mark as completed - let the UI handle completion state
            return {
              success: true,
              completed: isComplete,
              message: "Scout updated successfully",
            };
          }

          return { success: true, completed: false };
        },
      },
    },
    async onFinish({ text }) {
      // Save assistant message to database
      await supabaseServer.from("scout_messages").insert({
        scout_id: scoutId,
        role: "assistant",
        content: text,
      });
    },
  });

  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
