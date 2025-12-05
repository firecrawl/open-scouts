"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  MessageResponse,
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import { ScoutChecklistTool } from "@/components/scout-checklist-tool";

import { Fragment, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { supabase } from "@/lib/supabase/client";
import {
  CopyIcon,
  CornerDownLeftIcon,
  RefreshCcwIcon,
  Settings,
} from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import posthog from "posthog-js";
import { ScoutSettingsModal } from "@/components/scout-settings-modal";
import { Button } from "@/components/ui/shadcn-default/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/shadcn-default/tooltip";

type Scout = {
  id: string;
  title: string;
  description: string;
  goal: string;
  search_queries: string[];
  location: {
    city: string;
    state?: string;
    country?: string;
    latitude: number;
    longitude: number;
  } | null;
  frequency: "daily" | "every_3_days" | "weekly" | null;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

type Location = {
  city: string;
  state?: string;
  country?: string;
  latitude: number;
  longitude: number;
};

export default function ScoutPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const scoutId = params.id as string;
  const initialQuery = searchParams.get("initialQuery");
  const hasAutoSubmitted = useRef(false);

  const [input, setInput] = useState("");
  const [location, setLocation] = useState<Location | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentScout, setCurrentScout] = useState<Scout | null>(null);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [shouldAnimateButton, setShouldAnimateButton] = useState(false);
  const wasButtonDisabled = useRef(true);
  const [requestingLocation, setRequestingLocation] = useState(false);

  const { messages, setMessages, sendMessage, status, regenerate } = useChat({
    id: scoutId,
    onFinish: () => {
      // Reload current scout after each message to update status indicators
      loadCurrentScout();
    },
    onError: (error) => {
      console.error("Chat error:", error);
    },
  });

  // Loading state: true when submitted OR streaming
  const isLoading = status === "submitted" || status === "streaming";

  // Track if user location has been attempted to load
  const [locationLoaded, setLocationLoaded] = useState(false);

  // Request browser geolocation and save to user preferences
  const requestBrowserLocation = useCallback(async (userId: string) => {
    if (!("geolocation" in navigator)) {
      return null;
    }

    setRequestingLocation(true);

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        },
      );

      const { latitude, longitude } = position.coords;

      // Reverse geocode using OpenStreetMap Nominatim
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
      );
      const data = await response.json();

      const city =
        data.address?.city ||
        data.address?.town ||
        data.address?.village ||
        data.address?.municipality ||
        null;
      const state = data.address?.state || null;
      const country = data.address?.country || "Unknown";
      const countryCode = data.address?.country_code?.toUpperCase() || "XX";

      const userLocation = {
        country,
        countryCode,
        state,
        stateCode: null,
        city,
        latitude,
        longitude,
      };

      // Save to user preferences
      const { data: existing } = await supabase
        .from("user_preferences")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("user_preferences")
          .update({ location: userLocation })
          .eq("user_id", userId);
      } else {
        await supabase
          .from("user_preferences")
          .insert({ user_id: userId, location: userLocation });
      }

      // Convert to Location type
      const locationData: Location = {
        city: city || country || "Unknown",
        state: state || undefined,
        country: country || undefined,
        latitude,
        longitude,
      };

      return locationData;
    } catch (error) {
      console.error("Error getting browser location:", error);
      return null;
    } finally {
      setRequestingLocation(false);
    }
  }, []);

  // Load user's location from preferences
  useEffect(() => {
    const loadUserLocation = async () => {
      try {
        // Get current user
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.id) {
          setLocationLoaded(true);
          return;
        }

        // Load location from user preferences
        const { data } = await supabase
          .from("user_preferences")
          .select("location")
          .eq("user_id", user.id)
          .maybeSingle();

        if (data?.location) {
          const userLoc = data.location;
          const locationData: Location = {
            city: userLoc.city || userLoc.country || "Unknown",
            state: userLoc.state || undefined,
            country: userLoc.country || undefined,
            latitude: userLoc.latitude || 0,
            longitude: userLoc.longitude || 0,
          };

          setLocation(locationData);
        } else {
          // No location saved - request browser geolocation permission
          const browserLocation = await requestBrowserLocation(user.id);
          if (browserLocation) {
            setLocation(browserLocation);
          }
        }
      } catch (error) {
        console.error("Error loading user location:", error);
      } finally {
        setLocationLoaded(true);
      }
    };

    loadUserLocation();
  }, [requestBrowserLocation]);

  const loadCurrentScout = useCallback(async () => {
    if (scoutId && scoutId !== "new") {
      const { data } = await supabase
        .from("scouts")
        .select("*")
        .eq("id", scoutId)
        .single();
      if (data) setCurrentScout(data);
    }
  }, [scoutId]);

  const loadMessagesFromDB = useCallback(
    async (scoutId: string) => {
      const { data } = await supabase
        .from("scout_messages")
        .select("*")
        .eq("scout_id", scoutId)
        .order("created_at", { ascending: true });

      if (data && data.length > 0) {
        // Convert DB messages to UIMessage format
        const uiMessages = data.map(
          (msg: {
            id: string;
            role: "system" | "user" | "assistant";
            content: string;
          }) => ({
            id: msg.id,
            role: msg.role,
            parts: [{ type: "text" as const, text: msg.content }],
          }),
        );
        setMessages(uiMessages);
      } else {
        setMessages([]);
      }
    },
    [setMessages],
  );

  const createNewScout = async () => {
    const { data, error } = await supabase
      .from("scouts")
      .insert({
        title: "New Scout",
        location: location,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating scout:", error);
      return;
    }

    if (data) {
      router.push(`/scout/${data.id}`);
    }
  };

  const updateScoutTitle = async (scoutId: string, firstMessage: string) => {
    const title =
      firstMessage.slice(0, 50) + (firstMessage.length > 50 ? "..." : "");
    await supabase.from("scouts").update({ title }).eq("id", scoutId);
    loadCurrentScout();
  };

  const activateScout = async () => {
    if (!scoutId || scoutId === "new" || !currentScout) {
      return;
    }

    // If scout is already active, just navigate to executions page without autoRun
    if (currentScout.is_active) {
      router.push(`/${scoutId}`);
      return;
    }

    // Activate the scout
    const { error } = await supabase
      .from("scouts")
      .update({ is_active: true })
      .eq("id", scoutId);

    if (error) {
      console.error("Error activating scout:", error);
      return;
    }

    // PostHog: Track scout activation
    posthog.capture("scout_activated", {
      scout_id: scoutId,
      scout_title: currentScout.title,
      frequency: currentScout.frequency,
      has_location: !!currentScout.location,
      search_queries_count: currentScout.search_queries?.length || 0,
    });

    // Navigate to scout's execution page with autoRun parameter
    router.push(`/${scoutId}?autoRun=true`);
  };

  const handleSubmit = (message: PromptInputMessage) => {
    if (!scoutId || scoutId === "new") {
      createNewScout();
      return;
    }

    if (!message.text?.trim()) {
      return;
    }

    // Update scout title with first message
    if (messages.length === 0) {
      updateScoutTitle(scoutId, message.text);
    }

    sendMessage(
      {
        text: message.text,
      },
      {
        body: {
          scoutId,
          location,
        },
      },
    );
    setInput("");
  };

  useEffect(() => {
    if (scoutId && scoutId !== "new") {
      setMessagesLoaded(false);
      Promise.all([loadMessagesFromDB(scoutId), loadCurrentScout()]).finally(
        () => {
          setMessagesLoaded(true);
        },
      );
    } else {
      setMessagesLoaded(true);
    }
  }, [scoutId, loadMessagesFromDB, loadCurrentScout]);

  // Auto-submit initial query from URL parameter
  useEffect(() => {
    if (
      messagesLoaded &&
      locationLoaded &&
      initialQuery &&
      !hasAutoSubmitted.current &&
      messages.length === 0 &&
      scoutId &&
      scoutId !== "new"
    ) {
      hasAutoSubmitted.current = true;

      // Clean up URL parameter using history API (doesn't trigger React re-render)
      window.history.replaceState({}, "", `/scout/${scoutId}`);

      // Send the initial query (location can be null if user hasn't set one)
      sendMessage(
        {
          text: initialQuery,
        },
        {
          body: {
            scoutId,
            location,
          },
        },
      );
    }
  }, [
    messagesLoaded,
    locationLoaded,
    initialQuery,
    messages.length,
    scoutId,
    location,
    sendMessage,
  ]);

  // Track when button becomes enabled to trigger animation
  // Note: Using ref to track completion state to avoid duplicate events
  const hasTrackedCompletion = useRef(false);

  const handleScoutCompletion = useCallback(() => {
    if (!currentScout || hasTrackedCompletion.current) return;

    const isComplete =
      currentScout.title &&
      currentScout.goal &&
      currentScout.description &&
      currentScout.location &&
      currentScout.search_queries?.length > 0 &&
      currentScout.frequency;

    if (wasButtonDisabled.current && isComplete) {
      setShouldAnimateButton(true);
      wasButtonDisabled.current = false;

      // PostHog: Track scout configuration completion
      hasTrackedCompletion.current = true;
      posthog.capture("scout_configuration_completed", {
        scout_id: scoutId,
        scout_title: currentScout.title,
        frequency: currentScout.frequency,
        location_city: currentScout.location?.city,
        search_queries_count: currentScout.search_queries?.length || 0,
      });
    } else if (!isComplete) {
      wasButtonDisabled.current = true;
      setShouldAnimateButton(false);
    }
  }, [currentScout, scoutId]);

  // Call handler when currentScout changes
  useEffect(() => {
    handleScoutCompletion();
  }, [handleScoutCompletion]);

  return (
    <div className="bg-gray-50 overflow-hidden flex flex-col h-[calc(100vh-7rem)]">
      {/* Header */}
      {scoutId && scoutId !== "new" && currentScout && (
        <div className="border-b border-gray-200 bg-white px-24 py-12 md:px-24 md:py-16">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-12">
            <div className="flex-1 min-w-0">
              <h1 className="text-body-large md:text-title-h4 text-gray-900 truncate font-semibold">
                {currentScout.title || "New Scout"}
                {currentScout.goal && (
                  <span className="hidden md:inline text-body-small text-gray-500 font-normal ml-8">
                    ({currentScout.goal})
                  </span>
                )}
              </h1>
            </div>
            <div className="flex items-center gap-4 md:gap-12 shrink-0">
              <div className="flex items-center gap-4 md:gap-8">
                <div
                  className={`w-8 h-8 rounded-full ${
                    currentScout.is_active ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="hidden md:inline text-body-medium text-gray-600 whitespace-nowrap">
                  {currentScout.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSettingsOpen(true)}
                className="w-32 h-32 md:w-40 md:h-40"
              >
                <Settings className="w-16 h-16 md:w-20 md:h-20" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {scoutId && scoutId !== "new" ? (
          messagesLoaded ? (
            <div className="max-w-4xl mx-auto p-16 md:p-24 relative w-full h-full flex flex-col">
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-8">
                <Conversation className="overflow-hidden scroll-smooth [&::-webkit-scrollbar]:w-8 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-400">
                  <ConversationContent className="pb-[180px] md:pb-24">
                    {messages.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-gray-500 py-48">
                        <p className="text-body-medium text-gray-400">
                          Start by describing what you want to scout...
                        </p>
                      </div>
                    ) : (
                      <>
                        {messages.map((message, messageIndex) => {
                          const isLastMessage =
                            messageIndex === messages.length - 1;

                          return (
                            <div key={message.id}>
                              {message.parts.map((part, i) => {
                                if (part.type === "text") {
                                  const isLastPart =
                                    i === message.parts.length - 1;
                                  const isAssistant =
                                    message.role === "assistant";

                                  return (
                                    <Fragment key={`${message.id}-${i}`}>
                                      <Message from={message.role}>
                                        <MessageContent>
                                          <MessageResponse>
                                            {part.text}
                                          </MessageResponse>
                                        </MessageContent>
                                      </Message>

                                      {/* Show checklist after the last assistant message */}
                                      {isAssistant &&
                                        isLastPart &&
                                        isLastMessage &&
                                        currentScout &&
                                        !isLoading && (
                                          <div className="mt-16 mb-8">
                                            <ScoutChecklistTool
                                              currentScout={currentScout}
                                              currentLocation={location}
                                              onScoutUpdate={loadCurrentScout}
                                            />
                                          </div>
                                        )}

                                      {isAssistant &&
                                        isLastPart &&
                                        !isLoading && (
                                          <MessageActions className="mt-8">
                                            <MessageAction
                                              onClick={() => regenerate()}
                                              label="Retry"
                                            >
                                              <RefreshCcwIcon className="w-12 h-12" />
                                            </MessageAction>
                                            <MessageAction
                                              onClick={() =>
                                                navigator.clipboard.writeText(
                                                  part.text,
                                                )
                                              }
                                              label="Copy"
                                            >
                                              <CopyIcon className="w-12 h-12" />
                                            </MessageAction>
                                          </MessageActions>
                                        )}
                                    </Fragment>
                                  );
                                }

                                return null;
                              })}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </ConversationContent>
                  <ConversationScrollButton />
                </Conversation>

                {/* Desktop input - inline */}
                <div className="hidden md:block mt-16">
                  {/* Streaming indicator */}
                  {isLoading && (
                    <div className="flex items-center justify-center gap-8 mb-8">
                      <div className="bg-primary rounded-full px-12 py-6 shadow-sm flex items-center gap-8 text-white">
                        <Loader size={14} />
                        <span className="text-body-small">
                          Setting up your scout...
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="relative rounded-8 border border-gray-200 bg-white overflow-hidden">
                    <PromptInput
                      onSubmit={handleSubmit}
                      className="border-0 shadow-none [&_[data-slot=input-group]]:block"
                    >
                      <PromptInputTextarea
                        onChange={(e) => setInput(e.target.value)}
                        value={input}
                        placeholder="Describe what you'd like to scout and our agent will handle the rest..."
                        className="pr-56 w-full"
                      />
                    </PromptInput>
                    <button
                      type="button"
                      disabled={!input}
                      onClick={() => {
                        const form = document.querySelector(
                          "form",
                        ) as HTMLFormElement;
                        if (form) form.requestSubmit();
                      }}
                      className="absolute bottom-8 right-8 w-40 h-40 rounded-8 bg-heat-100 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-heat-80 transition-colors"
                    >
                      <CornerDownLeftIcon className="w-20 h-20" />
                    </button>
                  </div>
                  {currentScout &&
                    (() => {
                      const isComplete =
                        currentScout.title &&
                        currentScout.goal &&
                        currentScout.description &&
                        currentScout.location &&
                        currentScout.search_queries?.length > 0 &&
                        currentScout.frequency;

                      const buttonText = currentScout.is_active
                        ? "Update Scout"
                        : "Activate Scout";

                      return (
                        <div className="mt-8 flex justify-end">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  onClick={activateScout}
                                  disabled={!isComplete}
                                  className={
                                    isComplete && shouldAnimateButton
                                      ? "animate-bounce"
                                      : ""
                                  }
                                >
                                  {buttonText}
                                </Button>
                              </TooltipTrigger>
                              {!isComplete && (
                                <TooltipContent>
                                  <p className="text-body-small">
                                    Complete scout configuration first
                                  </p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      );
                    })()}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Loader size={24} />
            </div>
          )
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <p className="text-title-h5 mb-16">
                Create a new scout to get started
              </p>
              <Button onClick={() => router.push("/scouts")} size="lg">
                Go to Scouts
              </Button>
            </div>
          </div>
        )}

        {/* Mobile fixed bottom input */}
        {scoutId && scoutId !== "new" && messagesLoaded && (
          <div className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-50 border-t border-gray-200 p-12 pb-[calc(12px+env(safe-area-inset-bottom))] mx-20">
            {/* Streaming indicator */}
            {isLoading && (
              <div className="flex items-center justify-center gap-8 mb-8">
                <div className="bg-primary rounded-full px-12 py-6 shadow-sm flex items-center gap-8 text-white">
                  <Loader size={14} />
                  <span className="text-body-small">
                    Setting up your scout...
                  </span>
                </div>
              </div>
            )}
            <div className="relative rounded-8 border border-gray-200 bg-white overflow-hidden">
              <PromptInput
                onSubmit={handleSubmit}
                className="border-0 shadow-none [&_[data-slot=input-group]]:block"
              >
                <PromptInputTextarea
                  onChange={(e) => setInput(e.target.value)}
                  value={input}
                  placeholder="Describe what you'd like to scout..."
                  className="pr-56 w-full"
                />
              </PromptInput>
              <button
                type="button"
                disabled={!input}
                onClick={() => {
                  const form = document.querySelector(
                    "form",
                  ) as HTMLFormElement;
                  if (form) form.requestSubmit();
                }}
                className="absolute bottom-8 right-8 w-40 h-40 rounded-8 bg-heat-100 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-heat-80 transition-colors"
              >
                <CornerDownLeftIcon className="w-20 h-20" />
              </button>
            </div>
            {currentScout &&
              (() => {
                const isComplete =
                  currentScout.title &&
                  currentScout.goal &&
                  currentScout.description &&
                  currentScout.location &&
                  currentScout.search_queries?.length > 0 &&
                  currentScout.frequency;

                const buttonText = currentScout.is_active
                  ? "Update Scout"
                  : "Activate Scout";

                return (
                  <div className="mt-8 flex justify-end">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            onClick={activateScout}
                            disabled={!isComplete}
                            className={
                              isComplete && shouldAnimateButton
                                ? "animate-bounce"
                                : ""
                            }
                          >
                            {buttonText}
                          </Button>
                        </TooltipTrigger>
                        {!isComplete && (
                          <TooltipContent>
                            <p className="text-body-small">
                              Complete scout configuration first
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                );
              })()}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <ScoutSettingsModal
        scout={currentScout}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        currentLocation={location}
        onScoutUpdate={() => {
          loadCurrentScout();
        }}
      />
    </div>
  );
}
