"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { ScoutExecutionPanel } from "@/components/scout-execution-panel";
import { Settings, Play, Trash2, Menu, Eye, Clock } from "lucide-react";
import Button from "@/components/ui/shadcn/button";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { Switch } from "@/components/ui/shadcn/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Connector } from "@/components/shared/layout/curvy-rect";
import SymbolColored from "@/components/shared/icons/symbol-colored";
import Tooltip from "@/components/ui/shadcn/tooltip";
import posthog from "posthog-js";

// Rate limit: 20 minutes between manual runs
const MANUAL_RUN_COOLDOWN_MS = 20 * 60 * 1000;

// Timeout for waiting for execution to appear in database after triggering
const TRIGGER_TIMEOUT_MS = 60 * 1000; // 60 seconds

type Scout = {
  id: string;
  title: string;
  description: string;
  goal: string;
  is_active: boolean;
  created_at: string;
};

type Execution = {
  id: string;
  scout_id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
};

export default function ExecutionsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scoutId = params.id as string;
  const [scout, setScout] = useState<Scout | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [showNotFound, setShowNotFound] = useState(false);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const hasAutoTriggered = useRef(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const triggerTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const executionCountBeforeTrigger = useRef<number>(0);

  const triggerExecution = useCallback(async () => {
    setTriggering(true);

    // Store current execution count to detect when a new one arrives
    executionCountBeforeTrigger.current = executions.length;

    // Clear any existing timeout
    if (triggerTimeoutRef.current) {
      clearTimeout(triggerTimeoutRef.current);
    }

    try {
      const response = await fetch("/api/scout/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scoutId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || errorData.details || "Failed to trigger execution",
        );
      }

      // PostHog: Track scout execution triggered
      posthog.capture("scout_execution_triggered", {
        scout_id: scoutId,
        trigger_source: "manual",
      });

      // API call succeeded - keep triggering=true until execution appears in DB
      // Set timeout as fallback - if execution doesn't appear within 60 seconds, stop waiting
      triggerTimeoutRef.current = setTimeout(() => {
        setTriggering(false);
        console.warn("Timeout waiting for execution to appear in database");
      }, TRIGGER_TIMEOUT_MS);
    } catch (error) {
      console.error("Error triggering execution:", error);
      const message =
        error instanceof Error ? error.message : "Failed to trigger execution";
      alert(message);
      setTriggering(false);
    }
  }, [scoutId, executions.length]);

  const openClearDialog = () => {
    setClearDialogOpen(true);
  };

  const confirmClearExecutions = async () => {
    if (!scoutId) return;

    const executionsCount = executions.length;

    const { error } = await supabase
      .from("scout_executions")
      .delete()
      .eq("scout_id", scoutId);

    if (error) {
      console.error("Error clearing executions:", error);
      alert("Failed to clear executions. Please try again.");
      return;
    }

    // PostHog: Track execution history cleared
    posthog.capture("execution_history_cleared", {
      scout_id: scoutId,
      executions_cleared: executionsCount,
    });

    setClearDialogOpen(false);
    await loadExecutions();
    // Trigger refresh in child component
    setRefreshTrigger((prev) => prev + 1);
  };

  const cancelClear = () => {
    setClearDialogOpen(false);
  };

  // Load executions to check for running status
  const loadExecutions = useCallback(async () => {
    const { data } = await supabase
      .from("scout_executions")
      .select("id, scout_id, status, started_at, completed_at")
      .eq("scout_id", scoutId)
      .order("started_at", { ascending: false })
      .limit(10);

    if (data) {
      setExecutions(data);
    }
  }, [scoutId]);

  useEffect(() => {
    if (!scoutId) return;

    const loadScout = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("scouts")
        .select("*")
        .eq("id", scoutId)
        .single();

      if (error) {
        console.error("Error loading scout:", error);
        setLoading(false);
        return;
      }

      if (data) {
        // Redirect inactive scouts to configuration page
        if (!data.is_active) {
          router.replace(`/scout/${scoutId}`);
          return;
        }
        setScout(data);
        // PostHog: Track execution results page viewed
        posthog.capture("scout_results_viewed", {
          scout_id: data.id,
          scout_title: data.title,
          is_active: data.is_active,
        });
      }
      setLoading(false);
    };

    loadScout();
    loadExecutions();
  }, [scoutId, loadExecutions]);

  // Subscribe to execution changes
  useEffect(() => {
    if (!scoutId) return;

    const executionSubscription = supabase
      .channel(`executions-status-${scoutId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scout_executions",
          filter: `scout_id=eq.${scoutId}`,
        },
        () => {
          loadExecutions();
        },
      )
      .subscribe();

    return () => {
      executionSubscription.unsubscribe();
    };
  }, [scoutId, loadExecutions]);

  // Clear triggering state when a new execution appears in the database
  useEffect(() => {
    if (
      triggering &&
      executions.length > executionCountBeforeTrigger.current
    ) {
      // New execution has appeared - clear the triggering state
      // hasRunningExecution will now take over to keep button disabled
      setTriggering(false);
      if (triggerTimeoutRef.current) {
        clearTimeout(triggerTimeoutRef.current);
        triggerTimeoutRef.current = null;
      }
    }
  }, [executions.length, triggering]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (triggerTimeoutRef.current) {
        clearTimeout(triggerTimeoutRef.current);
      }
    };
  }, []);

  // Calculate and update cooldown remaining
  useEffect(() => {
    if (executions.length === 0) {
      setCooldownRemaining(0);
      return;
    }

    // Get the most recent execution's start time
    const mostRecentExecution = executions[0]; // Already sorted by started_at DESC
    const lastRunTime = new Date(mostRecentExecution.started_at).getTime();

    const calculateRemaining = () => {
      const now = Date.now();
      const elapsed = now - lastRunTime;
      const remaining = Math.max(0, MANUAL_RUN_COOLDOWN_MS - elapsed);
      setCooldownRemaining(remaining);
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);

    return () => clearInterval(interval);
  }, [executions]);

  // Auto-trigger execution if autoRun parameter is present
  useEffect(() => {
    const autoRun = searchParams.get("autoRun");
    if (autoRun === "true" && !hasAutoTriggered.current && !loading && scout) {
      hasAutoTriggered.current = true;
      // Clean up URL parameter
      router.replace(`/${scoutId}`, { scroll: false });
      // Trigger execution
      triggerExecution();
    }
  }, [searchParams, loading, scout, scoutId, router, triggerExecution]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background-base">
        {/* Top border line */}
        <div className="h-1 w-full bg-border-faint" />

        <div className="container relative">
          {/* Corner connectors */}
          <Connector className="absolute -top-10 -left-[10.5px]" />
          <Connector className="absolute -top-10 -right-[10.5px]" />

          {/* Header Section */}
          <div className="py-48 lg:py-64 relative">
            <div className="h-1 bottom-0 absolute w-screen left-[calc(50%-50vw)] bg-border-faint" />
            <Connector className="absolute -bottom-10 -left-[10.5px]" />
            <Connector className="absolute -bottom-10 -right-[10.5px]" />

            <div className="flex flex-col items-center gap-24">
              <Skeleton className="h-36 w-320 rounded-8" />
              <Skeleton className="h-20 w-480 rounded-6" />

              {/* Controls skeleton */}
              <div className="flex items-center gap-16 mt-16">
                <Skeleton className="h-32 w-100 rounded-8" />
                <Skeleton className="h-32 w-140 rounded-8" />
                <Skeleton className="h-32 w-32 rounded-8" />
              </div>
            </div>
          </div>

          {/* Content skeleton */}
          <div className="py-48">
            <div className="max-w-800 mx-auto space-y-32">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="space-y-16">
                  <div className="flex items-center gap-16">
                    <Skeleton className="h-16 w-200 rounded-4" />
                    <div className="flex-1 h-1 bg-border-faint" />
                    <Skeleton className="h-32 w-80 rounded-6" />
                  </div>
                  <Skeleton className="h-24 w-3/4 rounded-4" />
                  <Skeleton className="h-16 w-full rounded-4" />
                  <Skeleton className="h-16 w-5/6 rounded-4" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!scout) {
    return (
      <div className="min-h-screen bg-background-base">
        <div className="h-1 w-full bg-border-faint" />
        <div className="container relative py-160">
          <Connector className="absolute -top-10 -left-[10.5px]" />
          <Connector className="absolute -top-10 -right-[10.5px]" />

          <div className="flex flex-col items-center justify-center text-center">
            <SymbolColored className="w-64 h-auto mb-32 opacity-30" />
            <h2 className="text-title-h4 font-semibold text-accent-black mb-12">
              Scout not found
            </h2>
            <p className="text-body-large text-black-alpha-56 mb-32 max-w-400">
              The scout you&apos;re looking for doesn&apos;t exist or has been
              deleted.
            </p>
            <Button onClick={() => router.push("/scouts")}>Go to Scouts</Button>
          </div>
        </div>
      </div>
    );
  }

  // Check if there's a running execution
  const hasRunningExecution = executions.some(
    (execution) => execution.status === "running",
  );
  const isOnCooldown = cooldownRemaining > 0;
  const isInRunningState = triggering || hasRunningExecution;
  const isButtonDisabled = triggering || hasRunningExecution || isOnCooldown;

  // Format cooldown remaining as MM:SS
  const formatCooldown = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-background-base">
      {/* Top border line */}
      <div className="h-1 w-full bg-border-faint" />

      <div className="container relative">
        {/* Corner connectors */}
        <Connector className="absolute -top-10 -left-[10.5px]" />
        <Connector className="absolute -top-10 -right-[10.5px]" />

        {/* Header Section */}
        <div className="py-48 lg:py-64 relative">
          {/* Bottom border */}
          <div className="h-1 bottom-0 absolute w-screen left-[calc(50%-50vw)] bg-border-faint" />
          <Connector className="absolute -bottom-10 -left-[10.5px]" />
          <Connector className="absolute -bottom-10 -right-[10.5px]" />

          <div className="flex flex-col items-center">
            {/* Title */}
            <h1 className="text-title-h3 lg:text-title-h2 font-semibold text-accent-black text-center mb-12">
              {scout.title || "Scout Executions"}
            </h1>

            {/* Goal description */}
            {scout.goal && (
              <p className="text-body-large text-black-alpha-56 text-center max-w-600 mb-24">
                {scout.goal}
              </p>
            )}

            {/* Status and Controls */}
            <div className="flex items-center justify-center gap-16 lg:gap-24 flex-wrap">
              {/* Status indicator */}
              <div className="flex items-center gap-8">
                <div
                  className={`w-8 h-8 rounded-full ${
                    scout.is_active ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-mono-x-small font-mono text-black-alpha-48 uppercase tracking-wider">
                  {scout.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              {/* Divider */}
              <div className="w-1 h-16 bg-border-faint hidden sm:block" />

              {/* Desktop controls */}
              <div className="hidden sm:flex items-center gap-12">
                <div className="flex items-center gap-8">
                  <Switch
                    id="show-not-found"
                    checked={showNotFound}
                    onCheckedChange={setShowNotFound}
                    size="sm"
                  />
                  <label
                    htmlFor="show-not-found"
                    className="text-mono-x-small font-mono text-black-alpha-48 cursor-pointer"
                  >
                    Show Not Found
                  </label>
                </div>
              </div>

              {/* Divider */}
              <div className="w-1 h-16 bg-border-faint hidden sm:block" />

              {/* Action buttons */}
              <div className="hidden sm:flex items-center gap-8">
                <div className="relative">
                  <Tooltip
                    description={
                      isOnCooldown
                        ? `Cooldown active. You can run again in ${formatCooldown(cooldownRemaining)}`
                        : undefined
                    }
                  />
                  <Button
                    onClick={triggerExecution}
                    disabled={isButtonDisabled}
                    isLoading={isInRunningState}
                    loadingLabel="Running Scout"
                    className={isOnCooldown ? "min-w-[120px]" : ""}
                  >
                    {!isInRunningState && !isOnCooldown && (
                      <Play className="w-16 h-16" />
                    )}
                    {isOnCooldown && <Clock className="w-16 h-16" />}
                    {isOnCooldown
                      ? formatCooldown(cooldownRemaining)
                      : "Run Now"}
                  </Button>
                </div>

                <Button
                  onClick={openClearDialog}
                  variant="secondary"
                  disabled={executions.length === 0}
                >
                  <Trash2 className="w-16 h-16" />
                </Button>

                <Button
                  onClick={() => router.push(`/scout/${scoutId}`)}
                  variant="secondary"
                >
                  <Settings className="w-16 h-16" />
                </Button>
              </div>

              {/* Mobile controls */}
              <div className="flex sm:hidden items-center gap-8">
                {/* Mobile Run Now button */}
                <Button
                  onClick={triggerExecution}
                  disabled={isButtonDisabled}
                  isLoading={isInRunningState}
                  loadingLabel="Running"
                  className={isOnCooldown ? "min-w-[100px]" : ""}
                >
                  {!isInRunningState && !isOnCooldown && (
                    <Play className="w-16 h-16" />
                  )}
                  {isOnCooldown && <Clock className="w-16 h-16" />}
                  {isOnCooldown
                    ? formatCooldown(cooldownRemaining)
                    : "Run Now"}
                </Button>

                {/* Mobile menu button */}
                <Button
                  onClick={() => setMobileMenuOpen(true)}
                  variant="secondary"
                >
                  <Menu className="w-16 h-16" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Section label */}
        <div className="py-24 lg:py-32 relative">
          <div className="h-1 bottom-0 absolute w-screen left-[calc(50%-50vw)] bg-border-faint" />

          <div className="flex items-center gap-16">
            <div className="w-2 h-16 bg-heat-100" />
            <div className="flex gap-12 items-center text-mono-x-small text-black-alpha-32 font-mono">
              <Eye className="w-14 h-14" />
              <span className="uppercase tracking-wider">
                Execution History
              </span>
              {executions.length > 0 && (
                <>
                  <span>·</span>
                  <span className="text-heat-100">
                    {executions.length} runs
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Execution Panel */}
        <div className="pb-64 pt-20">
          <ScoutExecutionPanel
            scoutId={scoutId}
            showNotFound={showNotFound}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </div>

      {/* Mobile Menu Dialog */}
      <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <DialogContent className="sm:hidden p-24">
          <DialogHeader>
            <DialogTitle>Scout Controls</DialogTitle>
          </DialogHeader>
          <div className="space-y-16 py-16">
            {/* Show Not Found Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-body-medium font-medium text-accent-black">
                Show Not Found
              </label>
              <Switch
                id="show-not-found-mobile"
                checked={showNotFound}
                onCheckedChange={setShowNotFound}
              />
            </div>

            {/* Clear Executions Button */}
            <Button
              onClick={() => {
                setMobileMenuOpen(false);
                openClearDialog();
              }}
              variant="secondary"
              className="w-full"
              disabled={executions.length === 0}
            >
              <Trash2 className="w-16 h-16" />
              Clear Executions
            </Button>

            {/* Settings Button */}
            <Button
              onClick={() => {
                setMobileMenuOpen(false);
                router.push(`/scout/${scoutId}`);
              }}
              variant="secondary"
              className="w-full"
            >
              <Settings className="w-16 h-16" />
              Scout Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear Executions Confirmation Dialog */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent className="p-24">
          <DialogHeader>
            <DialogTitle>Clear All Executions</DialogTitle>
            <DialogDescription>
              Are you sure you want to clear all executions for &quot;
              {scout.title}&quot;? This will permanently delete all execution
              history and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-row gap-12 justify-end mt-16">
            <Button variant="secondary" onClick={cancelClear}>
              Cancel
            </Button>
            <Button onClick={confirmClearExecutions} variant="destructive">
              Yes, Clear All
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
