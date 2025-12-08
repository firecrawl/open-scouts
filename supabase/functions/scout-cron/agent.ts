// Main agent orchestration logic

import type { Scout, ScoutResponse } from "./types.ts";
import { getMaxAge, isBlacklistedDomain } from "./constants.ts";
import {
  createStep,
  updateStep,
  getFirecrawlKeyForUser,
  logFirecrawlUsage,
  markFirecrawlKeyInvalid,
} from "./helpers.ts";
import { executeSearchTool, executeScrapeTool } from "./tools.ts";
import { sendScoutSuccessEmail } from "./email.ts";
import {
  trackExecutionStarted,
  trackExecutionCompleted,
  trackExecutionFailed,
  trackEmailNotificationSent,
  trackDuplicateDetected,
} from "./posthog.ts";

// Calculate cosine similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

// Execute the scout agent using OpenAI with tools
export async function executeScoutAgent(scout: Scout, supabase: any): Promise<void> {
  console.log(`Executing scout: ${scout.title} (${scout.id})`);

  // Create execution record
  const { data: execution, error: executionError } = await supabase
    .from("scout_executions")
    .insert({
      scout_id: scout.id,
      status: "running",
    })
    .select()
    .single();

  if (executionError || !execution) {
    console.error("Error creating execution:", executionError);
    return;
  }

  const executionId = execution.id;
  const executionStartTime = Date.now();
  let stepNumber = 0;
  const toolCalls: any[] = [];

  // Track execution started (fire-and-forget, don't await to avoid blocking)
  trackExecutionStarted(
    scout.user_id,
    scout.id,
    executionId,
    scout.title,
    "automatic" // Could be passed as param if manual trigger detection is needed
  );

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    // Get the user's Firecrawl API key - no fallback, each user must have their own key
    const firecrawlKeyResult = await getFirecrawlKeyForUser(
      supabase,
      scout.user_id
    );

    if (!firecrawlKeyResult.apiKey) {
      throw new Error("User does not have a valid Firecrawl API key configured. Please add your API key in Settings.");
    }

    const FIRECRAWL_API_KEY = firecrawlKeyResult.apiKey;

    // Track total API calls for usage logging
    let firecrawlApiCallsCount = 0;

    // Calculate maxAge based on frequency
    const maxAgeMs = getMaxAge(scout.frequency);

    // Query for similar previous executions to detect duplicates
    console.log(`Checking for similar previous executions...`);
    let similarExecutions: any[] = [];

    try {
      // Get the current execution's embedding query vector
      // We'll use a dummy embedding initially, then update after we have the actual summary
      // For now, query recent successful executions from the same scout
      const { data: recentExecutions } = await supabase
        .from("scout_executions")
        .select("id, summary_text, summary_embedding, completed_at")
        .eq("scout_id", scout.id)
        .eq("status", "completed")
        .not("summary_text", "is", null)
        .not("summary_embedding", "is", null)
        .order("completed_at", { ascending: false })
        .limit(20);

      if (recentExecutions && recentExecutions.length > 0) {
        // Filter out executions with invalid embeddings (null, undefined, or empty arrays)
        similarExecutions = recentExecutions.filter((exec) => {
          const embedding = exec.summary_embedding;
          const isValid = Array.isArray(embedding) && embedding.length === 1536;
          if (!isValid && embedding) {
            console.log(`⚠️ Filtering out execution from ${exec.completed_at} - invalid embedding length: ${Array.isArray(embedding) ? embedding.length : 'not an array'}`);
          }
          return isValid;
        });
        console.log(`Found ${similarExecutions.length} recent executions with valid embeddings (filtered from ${recentExecutions.length} total)`);
      }
    } catch (error: any) {
      console.error("Error querying similar executions:", error.message);
      // Continue execution even if similarity check fails
    }

    // Build recent findings context if available
    let recentFindingsContext = "";
    if (similarExecutions.length > 0) {
      const recentFindings = similarExecutions
        .slice(0, 5) // Only include the 5 most recent
        .map((exec, index) => {
          const daysAgo = Math.floor((Date.now() - new Date(exec.completed_at).getTime()) / (1000 * 60 * 60 * 24));
          const timeDesc = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
          return `${index + 1}. ${exec.summary_text} (found ${timeDesc})`;
        })
        .join("\n");

      recentFindingsContext = `

## Recent Previous Findings
The following results were found in recent executions of this scout. Check your current findings against these to avoid reporting duplicate news or information:

${recentFindings}

**IMPORTANT**: If your current findings are substantially similar to any of these recent results (same event, same news, same announcement), you should:
1. Set taskCompleted to false
2. Set taskStatus to "not_found"
3. In your response, briefly mention that the findings were already reported recently (e.g., "No new findings - similar results were already reported on [date]")

Only report NEW information that differs meaningfully from these recent findings.`;
    }

    const systemPrompt = `# SCOUT AGENT - Automated Monitor
Current date: ${new Date().toISOString().split('T')[0]}

## Your Mission
You are executing an automated scout for: "${scout.title}"

**Goal:** ${scout.goal}
**Description:** ${scout.description}
**Location:** ${scout.location?.city || "Not specified"}
**Search Queries Configured:** ${scout.search_queries.join(", ")}${recentFindingsContext}

## Your Task
Use the configured search queries to find relevant, recent information that matches the scout's goal.
Be thorough but efficient. You have a maximum of ~7 steps to complete this task.

**WORKFLOW - Follow this structured approach:**
1. **Initial Search Phase**: Start by searching using ONLY the configured search queries listed above (one search per query)
2. **Verification Phase**: Scrape 2-3 of the most relevant results from your searches to verify the information
3. **Optional Follow-up**: ONLY if you found promising leads that need clarification, do 1-2 additional targeted searches
4. **Complete**: Once you have verified information (or confirmed nothing new was found), provide your final response

**EFFICIENCY REQUIREMENTS:**
- Do NOT repeat the same or similar searches
- Do NOT scrape more than 3-5 websites total
- Do NOT continue searching if you've already found good verified results
- Do NOT keep searching hoping for better results - report what you found
- Aim to complete in 5-6 steps total (searches + scrapes + final response)

**CRITICAL - Focus on PRIMARY Information:**
Prioritize primary sources (announcements, openings, launches, listings) over secondary commentary (reviews, opinions, tutorials).

Ask yourself: "What is the NEW thing here?"
- NEW restaurant opening → REPORT IT | Review of existing restaurant → SKIP IT
- Product launch announcement → REPORT IT | Tutorial about existing product → SKIP IT

Favor concrete facts (dates, locations, specifics) over subjective commentary.

**CRITICAL - Verification Requirements:**
- You MUST scrape the actual websites to verify your findings - search snippets alone are NOT sufficient
- After searching, ALWAYS scrape the most relevant results (at least 2-3 URLs) to confirm accuracy
- Only report information you've verified by actually reading the full page content
- Search results can be outdated or misleading - scraping ensures you have accurate, current information
- If you cannot verify information through scraping, mark taskCompleted as false

## Response Format
You MUST respond with a structured JSON object with the following fields:
- taskCompleted: boolean (true if you found verified results, false if nothing was found)
- taskStatus: "completed" | "partial" | "not_found" | "insufficient_data"
- response: string (a comprehensive markdown-formatted answer that fully addresses the scout's goal)

**CRITICAL - Writing Style for Non-Technical Users:**
- Write like a NEWS BRIEF - present findings directly without mentioning your process
- NEVER mention technical details (e.g., "I scraped", "I verified") or meta-commentary about searches
- Present information as a news curator - state facts directly, avoid "I" statements about your process

**For the response field:**
- Write a CONCISE, well-structured markdown answer - NO LENGTHY EXPLANATIONS
- Start with a clear title (##) that describes WHAT was found (e.g., "## New AI Coding Tools Released" not "## Verified Recent Items")
- Open with 1-2 sentences stating the key findings directly (e.g., "Three new AI developer tools launched today..." not "In the past hour I found and scraped...")
- Use bullet points for structured information (dates, locations, hours, websites, key details)
- Keep it short and scannable - focus on essential facts only
- Include sources as inline links within the text or at the end
- NEVER use em dashes (—) - use regular hyphens (-) or colons (:) instead
- If taskCompleted is false, briefly state what was searched for and that nothing was found (1-2 sentences max)

**Example response format:**
\`\`\`json
{
  "taskCompleted": true,
  "taskStatus": "completed",
  "response": "## New Nepali-Indian Restaurant Opens in Denver\\n\\nMantra Cafe, a family-owned restaurant specializing in Nepali Indian fusion cuisine, has opened its doors in Denver's Golden Triangle/Museum District at 1147 Broadway.\\n\\n**Details:**\\n- **Opening Date**: June 14, 2025\\n- **Location**: 1147 Broadway, Denver, CO 80203\\n- **Hours**: 10:30 AM – 9:30 PM daily\\n- **Specialty**: Nepali Indian fusion featuring chicken tikka masala, momos, Sherpa stews, and naan tikka tacos\\n- **Website**: [mantracafedenver.com](https://mantracafedenver.com)\\n\\n*Sources: [Westword](url), [Denver Event Listing](url)*"
}
\`\`\`

## Available Tools
You have access to searchWeb and scrapeWebsite tools. Use them intelligently to gather and verify information.
`;

    // Determine the appropriate time filter
    const timeFilter = scout.frequency === 'daily' ? 'qdr:d' : scout.frequency === 'every_3_days' ? 'qdr:w' : 'qdr:w';
    const timeDescription = scout.frequency === 'daily' ? 'day' : scout.frequency === 'every_3_days' ? '3 days' : 'week';

    const userMessage = `Execute the scout using this STRUCTURED WORKFLOW:

**Step 1**: Search using the configured queries: ${scout.search_queries.join(", ")}
- Use the time filter (tbs: "${timeFilter}") to get results from the past ${timeDescription}
- Do ONE search per configured query

**Step 2**: Scrape 2-3 of the most relevant results to verify the information
- Focus on PRIMARY sources (announcements, listings, openings, events) not reviews/opinions
- Ask: "What is the NEW thing here?" - skip secondary commentary

**Step 3**: ONLY if needed, do 1-2 additional targeted searches for clarification

**Step 4**: Provide your final structured response

CRITICAL LIMITS:
- Maximum ~7 steps total (you're currently on step 0)
- Do NOT keep searching indefinitely
- Once you have verified findings OR confirmed nothing new exists, STOP and respond
- Efficiency over exhaustiveness - report what you found, don't keep hoping for more

REMINDER: Write your final response like a NEWS BRIEF. DO NOT mention your process (searching, scraping, verification). Just present the findings directly.`;

    // Step 1: Initial AI request with tools
    stepNumber++;
    await createStep(supabase, executionId, stepNumber, {
      step_type: "tool_call",
      description: "Initializing agent with OpenAI",
      input_data: { model: "gpt-5.1-2025-11-13", system: systemPrompt.substring(0, 200) + "..." },
      status: "running",
    });

    const conversationMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    let continueLoop = true;
    let loopCount = 0;
    const maxLoops = 7; // Reduced from 10 to stay under Firecrawl rate limits (6 req/min)
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while (continueLoop && loopCount < maxLoops) {
      loopCount++;
      console.log(`[${scout.title}] Loop ${loopCount}/${maxLoops}`);

      // Add a reminder about step limits if we're getting close
      if (loopCount > 1 && loopCount % 3 === 0) {
        conversationMessages.push({
          role: "system",
          content: `REMINDER: You've used approximately ${stepNumber} steps so far. Stay efficient and aim to complete soon. If you have verified findings, provide your final response now.`,
        });
      }

      // Add 60-second timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5.1-2025-11-13",
          messages: conversationMessages,
          tools: [
            {
              type: "function",
              function: {
                name: "searchWeb",
                description: "Search the web using Firecrawl. Returns results with snippets, published dates, and favicons.",
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "Search query" },
                    limit: { type: "number", description: "Number of results (1-10)", default: 5 },
                    tbs: { type: "string", description: "Time filter: qdr:h (hour), qdr:d (day), qdr:w (week), qdr:m (month)" },
                  },
                  required: ["query"],
                },
              },
            },
            {
              type: "function",
              function: {
                name: "scrapeWebsite",
                description: "Scrape a URL to get full page content and screenshots. ALWAYS use this to verify search results - scraping is essential for accurate information gathering. Returns markdown content and a screenshot URL.",
                parameters: {
                  type: "object",
                  properties: {
                    url: { type: "string", description: "URL to scrape" },
                  },
                  required: ["url"],
                },
              },
            },
          ],
          tool_choice: "auto",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${errorText}`);
      }

      const data = await response.json();
      const choice = data.choices[0];
      const assistantMessage = choice.message;

      conversationMessages.push(assistantMessage);

      // Check if we need to execute tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          stepNumber++;
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          // Log tool call
          await createStep(supabase, executionId, stepNumber, {
            step_type: toolName === "searchWeb" ? "search" : "scrape",
            description: `${toolName}: ${toolArgs.query || toolArgs.url}`,
            input_data: toolArgs,
            status: "running",
          });

          let toolResult: any;
          let hasError = false;

          // Execute the tool
          try {
            if (toolName === "searchWeb") {
              // Only pass location if it exists and is not "any"
              const locationToUse = scout.location?.city && scout.location.city !== "any"
                ? scout.location.city
                : undefined;
              toolResult = await executeSearchTool(toolArgs, FIRECRAWL_API_KEY, locationToUse, maxAgeMs);
              firecrawlApiCallsCount++;
            } else if (toolName === "scrapeWebsite") {
              toolResult = await executeScrapeTool(toolArgs, FIRECRAWL_API_KEY, maxAgeMs);
              firecrawlApiCallsCount++;
            }

            // Check if tool returned an error
            hasError = toolResult && typeof toolResult === 'object' && 'error' in toolResult;

            // Check for 401 Unauthorized errors - indicates invalid API key
            if (hasError && toolResult?.error?.includes('401')) {
              console.error(`[Firecrawl] 401 error detected - marking user key as invalid`);
              await markFirecrawlKeyInvalid(
                supabase,
                scout.user_id,
                `Firecrawl returned 401: ${toolResult.error}`
              );
            }
          } catch (error: any) {
            console.error(`Tool execution error for ${toolName}:`, error);
            toolResult = { error: error.message, query: toolArgs.query || toolArgs.url };
            hasError = true;
          }

          // Update step with result
          console.log(`[${scout.title}] Step ${stepNumber} (${toolName}) ${hasError ? 'failed' : 'completed'}`);
          await updateStep(supabase, executionId, stepNumber, {
            status: hasError ? "failed" : "completed",
            output_data: toolResult,
            error_message: hasError ? (toolResult as any).error : null,
          });

          // Track consecutive errors (but don't count errors for blacklisted domains)
          if (hasError) {
            // Check if this is a blacklisted domain error (shouldn't happen often after filtering)
            const isBlacklistedError = toolName === "scrapeWebsite" &&
                                       toolArgs.url &&
                                       isBlacklistedDomain(toolArgs.url);

            if (!isBlacklistedError) {
              consecutiveErrors++;
              console.error(`[${scout.title}] Tool error (${consecutiveErrors}/${maxConsecutiveErrors}): ${(toolResult as any).error}`);

              if (consecutiveErrors >= maxConsecutiveErrors) {
                throw new Error(`Too many consecutive tool errors (${maxConsecutiveErrors}). Last error: ${(toolResult as any).error}`);
              }
            } else {
              console.warn(`[${scout.title}] Skipped scraping blacklisted domain: ${toolArgs.url}`);
            }
          } else {
            consecutiveErrors = 0; // Reset on success
          }

          // Add tool result to conversation
          conversationMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          } as any);

          toolCalls.push({ tool: toolName, args: toolArgs, result: toolResult });
        }
      } else {
        // No more tool calls, agent is done
        continueLoop = false;

        // Parse the final response
        const finalContent = assistantMessage.content;
        let scoutResponse: ScoutResponse;

        try {
          // Clean up the response to extract JSON
          let jsonString = finalContent.trim();

          // Remove markdown code fences if present
          if (jsonString.includes('```json')) {
            jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '');
          } else if (jsonString.includes('```')) {
            jsonString = jsonString.replace(/```\s*/g, '');
          }

          // Find the last closing brace to handle any trailing text
          const lastBrace = jsonString.lastIndexOf('}');
          if (lastBrace !== -1) {
            jsonString = jsonString.substring(0, lastBrace + 1);
          }

          // Try to parse as JSON
          scoutResponse = JSON.parse(jsonString);
        } catch {
          // If not JSON, create a default response with the raw content as markdown
          scoutResponse = {
            taskCompleted: false,
            taskStatus: "insufficient_data",
            response: finalContent || "Agent completed without structured output",
          };
        }

        // Save final summary
        stepNumber++;
        await createStep(supabase, executionId, stepNumber, {
          step_type: "summarize",
          description: "Agent completed execution",
          output_data: scoutResponse,
          status: "completed",
        });

        // Generate one-sentence summary and embedding for successful executions
        let summaryText = null;
        let summaryEmbedding = null;

        if (scoutResponse.taskCompleted) {
          try {
            console.log(`Generating one-sentence summary...`);

            // Generate a concise one-sentence summary using OpenAI
            const summaryController = new AbortController();
            const summaryTimeoutId = setTimeout(() => summaryController.abort(), 60000);

            const summaryResponse = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "gpt-5.1-2025-11-13",
                messages: [
                  {
                    role: "system",
                    content: "You are a concise summarizer. Generate a single sentence (max 150 characters) that captures the key finding from the scout execution. Focus on what was discovered, not the process. Be specific and include key details like names, locations, or dates if present."
                  },
                  {
                    role: "user",
                    content: `Scout goal: ${scout.goal}\n\nFindings: ${scoutResponse.response}\n\nGenerate a one-sentence summary (max 150 characters) of the key discovery.`
                  }
                ],
              }),
              signal: summaryController.signal,
            });

            clearTimeout(summaryTimeoutId);

            if (summaryResponse.ok) {
              const summaryData = await summaryResponse.json();
              summaryText = summaryData.choices[0].message.content.trim();
              console.log(`Generated summary: ${summaryText}`);

              // Generate embedding for the summary
              console.log(`Generating embedding for summary...`);
              const embeddingController = new AbortController();
              const embeddingTimeoutId = setTimeout(() => embeddingController.abort(), 60000);

              const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${OPENAI_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "text-embedding-3-small",
                  input: summaryText,
                }),
                signal: embeddingController.signal,
              });

              clearTimeout(embeddingTimeoutId);

              if (embeddingResponse.ok) {
                const embeddingData = await embeddingResponse.json();
                summaryEmbedding = embeddingData.data[0].embedding;
                console.log(`Embedding generated successfully (${summaryEmbedding?.length || 0} dimensions)`);
              } else {
                console.error("Failed to generate embedding:", await embeddingResponse.text());
              }
            } else {
              console.error("Failed to generate summary:", await summaryResponse.text());
            }
          } catch (error: any) {
            console.error("Error generating summary/embedding:", error.message);
          }
        }

        // Check for similar previous executions using cosine similarity
        let isDuplicate = false;
        let similarityThreshold = 0.85; // Similarity threshold (0-1, where 1 is identical)

        if (scoutResponse.taskCompleted && summaryEmbedding && similarExecutions.length > 0) {
          const currentEmbedding = summaryEmbedding as number[];
          console.log(`\n🔍 DUPLICATE DETECTION: Checking cosine similarity against ${similarExecutions.length} previous executions...`);
          console.log(`Current summary: "${summaryText}"`);
          console.log(`Current embedding length: ${currentEmbedding.length}`);
          console.log(`Similarity threshold: ${similarityThreshold}`);

          for (const prevExecution of similarExecutions) {
            if (prevExecution.summary_embedding) {
              try {
                // Check if vectors have the same length
                const prevEmbedding = prevExecution.summary_embedding as number[];

                // Additional validation - should already be filtered but double-check
                if (!Array.isArray(prevEmbedding) || prevEmbedding.length !== 1536) {
                  console.log(`  ⚠️  Skipping comparison - invalid previous embedding (length: ${Array.isArray(prevEmbedding) ? prevEmbedding.length : 'not an array'}) for execution from ${prevExecution.completed_at}`);
                  continue;
                }

                if (prevEmbedding.length !== currentEmbedding.length) {
                  console.log(`  ⚠️  Skipping comparison - vector length mismatch (current: ${currentEmbedding.length}, previous: ${prevEmbedding.length}) for execution from ${prevExecution.completed_at}`);
                  continue;
                }

                const similarity = cosineSimilarity(currentEmbedding, prevEmbedding);
                const daysAgo = Math.floor((Date.now() - new Date(prevExecution.completed_at).getTime()) / (1000 * 60 * 60 * 24));
                const timeDesc = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;

                console.log(`  📊 Similarity: ${similarity.toFixed(4)} | Previous: "${prevExecution.summary_text}" (${timeDesc})`);

                if (similarity >= similarityThreshold) {
                  console.log(`  ⚠️  DUPLICATE DETECTED! Similarity ${similarity.toFixed(4)} >= ${similarityThreshold}`);
                  console.log(`  Previous execution: "${prevExecution.summary_text}"`);
                  console.log(`  Completed at: ${prevExecution.completed_at}`);
                  isDuplicate = true;

                  // Track duplicate detected
                  trackDuplicateDetected(
                    scout.user_id,
                    scout.id,
                    executionId,
                    scout.title,
                    similarity
                  );

                  // Update the response to indicate this is a duplicate
                  scoutResponse.response = `${scoutResponse.response}\n\n---\n**Note**: This finding appears very similar to a previous result from ${new Date(prevExecution.completed_at).toLocaleDateString()}: "${prevExecution.summary_text}" (similarity: ${(similarity * 100).toFixed(1)}%)`;
                  break;
                }
              } catch (error: any) {
                console.error(`  ❌ Error calculating similarity: ${error.message}`);
              }
            }
          }

          if (!isDuplicate) {
            console.log(`✅ No duplicates found - this is a new unique finding\n`);
          } else {
            console.log(`🚫 Duplicate detected - will skip email notification\n`);
          }
        } else if (scoutResponse.taskCompleted && summaryEmbedding) {
          console.log(`ℹ️  No previous executions to compare against - this is the first successful result\n`);
        }

        // Mark execution as completed - store as JSONB object with summary and embedding
        await supabase
          .from("scout_executions")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            results_summary: scoutResponse,
            summary_text: summaryText,
            summary_embedding: summaryEmbedding,
          })
          .eq("id", executionId);

        // Send email notification if scout was successful AND not a duplicate
        if (scoutResponse.taskCompleted && !isDuplicate) {
          console.log(`Scout found results, sending email notification...`);
          try {
            await sendScoutSuccessEmail(scout, scoutResponse, supabase);
            trackEmailNotificationSent(scout.user_id, scout.id, executionId, scout.title, true);
          } catch (emailError: any) {
            console.error(`Failed to send email notification:`, emailError.message);
            trackEmailNotificationSent(scout.user_id, scout.id, executionId, scout.title, false, emailError.message);
          }
        } else if (isDuplicate) {
          console.log(`📧 Skipping email notification - result is too similar to a previous finding`);
        }

        // Track execution completed
        trackExecutionCompleted(
          scout.user_id,
          scout.id,
          executionId,
          scout.title,
          {
            duration_ms: Date.now() - executionStartTime,
            steps_count: stepNumber,
            results_found: scoutResponse.taskCompleted,
            is_duplicate: isDuplicate,
            api_calls_count: firecrawlApiCallsCount,
          }
        );
      }
    }

    // Check if we hit max loops without finishing
    if (loopCount >= maxLoops) {
      console.warn(`[${scout.title}] Hit max loops (${maxLoops}), forcing completion`);

      // Create a summary indicating incomplete execution
      const incompleteSummary = {
        taskCompleted: false,
        taskStatus: "partial" as const,
        response: "The scout execution reached its maximum iteration limit. The AI agent may have encountered repeated errors or gotten stuck in a loop. Please check the execution steps for more details."
      };

      await supabase
        .from("scout_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          results_summary: incompleteSummary,
        })
        .eq("id", executionId);
    }

    // Update scout last_run_at
    await supabase
      .from("scouts")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", scout.id);

    // Log Firecrawl usage for monitoring
    if (firecrawlApiCallsCount > 0) {
      await logFirecrawlUsage(supabase, {
        userId: scout.user_id,
        scoutId: scout.id,
        executionId,
        usedFallback: firecrawlKeyResult.usedFallback,
        fallbackReason: firecrawlKeyResult.fallbackReason,
        apiCallsCount: firecrawlApiCallsCount,
      });
    }

    console.log(`Scout execution completed: ${scout.title}`);
  } catch (error: any) {
    console.error(`Error executing scout ${scout.id}:`, error);

    // Track execution failed
    trackExecutionFailed(
      scout.user_id,
      scout.id,
      executionId,
      scout.title,
      error.message,
      Date.now() - executionStartTime
    );

    // Mark current step as failed
    if (stepNumber > 0) {
      await updateStep(supabase, executionId, stepNumber, {
        status: "failed",
        error_message: error.message,
      });
    }

    // Mark execution as failed
    await supabase
      .from("scout_executions")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error.message,
      })
      .eq("id", executionId);
  }
}
