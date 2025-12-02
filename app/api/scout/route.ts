import { streamText, UIMessage, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { supabaseServer } from "@/lib/supabase/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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
    return new Response(JSON.stringify({ error: "Scout not found or unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
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
  const systemPrompt = `You are a helpful assistant guiding the user through creating and configuring a "Scout" - an automated monitoring and search task.

Your job is to have a natural conversation with the user to collect and update the following information:

**Required Scout Information:**
1. **Scout Title**: A short, descriptive name (e.g., "Brazilian Restaurants SF")
2. **Scout Goal**: What they're trying to monitor or find (e.g., "Find new Brazilian restaurants opening in San Francisco")
3. **Description**: A detailed explanation of what this scout does
4. **Location**: The user's location has been detected as ${location?.city || "unknown"}. Confirm if they want to search near this location or specify a different one.
5. **Search Queries**: 1-3 specific search terms that will be used (e.g., ["new Brazilian restaurants San Francisco", "Brazilian cuisine SF 2025"])
6. **Frequency**: How often should this scout run?
   - "hourly" - Run every hour
   - "every_3_days" - Run every 3 days
   - "weekly" - Run once per week

**Current Scout Status:**
${currentScout.title ? `- Title: ${currentScout.title}` : "- Title: Not set"}
${currentScout.goal ? `- Goal: ${currentScout.goal}` : "- Goal: Not set"}
${currentScout.description ? `- Description: ${currentScout.description}` : "- Description: Not set"}
${currentScout.location ? `- Location: ${currentScout.location.city}` : "- Location: Not set"}
${currentScout.search_queries?.length > 0 ? `- Search Queries: ${JSON.stringify(currentScout.search_queries)}` : "- Search Queries: Not set"}
${currentScout.frequency ? `- Frequency: ${currentScout.frequency}` : "- Frequency: Not set"}

**Important Guidelines:**
- Have a natural, conversational flow. Don't interrogate the user.
- Use the current scout status to avoid asking for information that's already set.
- When the user provides information, use the update_scout_config tool to save it immediately.
- If the user wants to change something that's already set, use the tool to update it.
- When ALL required fields are filled, congratulate the user and let them know their scout is complete and active.
- The user can continue chatting to make modifications even after completion.

**Available Tool:**
- update_scout_config: Use this to update any scout configuration fields. You can update multiple fields at once or just one field.

User's detected location: ${location ? `${location.city} (${location.latitude}, ${location.longitude})` : "Not available"}`;

  const result = streamText({
    model: openai("gpt-5.1-2025-11-13"),
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
            .optional()
            .describe("1-3 search terms to be used"),
          frequency: z
            .enum(["hourly", "every_3_days", "weekly"])
            .optional()
            .describe("How often the scout should run"),
        }),
        execute: async (params) => {
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

            if (isComplete) {
              return {
                success: true,
                completed: true,
                message: "Scout is now complete and ready!",
              };
            }

            return {
              success: true,
              completed: false,
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
