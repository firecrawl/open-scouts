"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Switch } from "@/components/ui/shadcn/switch";
import Input from "@/components/ui/shadcn/input";
import Textarea from "@/components/ui/shadcn/textarea";
import { Button } from "@/components/ui/shadcn-default/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { supabase } from "@/lib/supabase/client";
import { X, Plus, Pencil } from "lucide-react";
import posthog from "posthog-js";

type ScrapeOptions = {
  cookies?: string;
  headers?: Record<string, string>;
  waitFor?: number | string;
  timeout?: number;
};

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
  scrape_options?: ScrapeOptions;
};

type Location = {
  city: string;
  state?: string;
  country?: string;
  latitude: number;
  longitude: number;
};

type ScoutSettingsModalProps = {
  scout: Scout | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLocation?: Location | null;
  onScoutUpdate?: () => void;
};

export function ScoutSettingsModal({
  scout,
  open,
  onOpenChange,
  currentLocation,
  onScoutUpdate,
}: ScoutSettingsModalProps) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [description, setDescription] = useState("");
  const [searchQueries, setSearchQueries] = useState<string[]>([]);
  const [newQuery, setNewQuery] = useState("");
  const [frequency, setFrequency] = useState<
    "daily" | "every_3_days" | "weekly" | null
  >(null);
  const [isActive, setIsActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Scrape options state
  const [cookies, setCookies] = useState("");

  // Track which fields are in edit mode
  const [editMode, setEditMode] = useState({
    title: false,
    goal: false,
    description: false,
    location: false,
    cookies: false,
    searchQueries: false,
    frequency: false,
  });

  // Track location preference
  const [locationPreference, setLocationPreference] = useState<
    "current" | "any"
  >("current");

  // Update form when scout changes
  useEffect(() => {
    if (scout) {
      setTitle(scout.title || "");
      setGoal(scout.goal || "");
      setDescription(scout.description || "");
      setSearchQueries(scout.search_queries || []);
      setFrequency(scout.frequency);
      setIsActive(scout.is_active);
      setCookies(scout.scrape_options?.cookies || "");
      // Check if location is "any" (0, 0) or a real location
      const isAnyLocation =
        scout.location &&
        scout.location.latitude === 0 &&
        scout.location.longitude === 0;
      setLocationPreference(isAnyLocation ? "any" : "current");
    }
  }, [scout]);

  // Reset edit modes when modal opens/closes
  useEffect(() => {
    if (!open) {
      setEditMode({
        title: false,
        goal: false,
        description: false,
        location: false,
        cookies: false,
        searchQueries: false,
        frequency: false,
      });
    }
  }, [open]);

  if (!scout) return null;

  const frequencyLabels = {
    daily: "Daily",
    every_3_days: "Every 3 days",
    weekly: "Weekly",
  };

  const handleActiveToggle = async (checked: boolean) => {
    setIsActive(checked);
    await supabase
      .from("scouts")
      .update({ is_active: checked })
      .eq("id", scout.id);

    // PostHog: Track scout activation/deactivation
    posthog.capture(checked ? "scout_activated" : "scout_deactivated", {
      scout_id: scout.id,
      scout_title: scout.title,
      source: "settings_modal",
    });

    // Trigger callback to reload scout data
    if (onScoutUpdate) {
      onScoutUpdate();
    }
  };

  const handleAddQuery = () => {
    if (newQuery.trim() && searchQueries.length < 5) {
      setSearchQueries([...searchQueries, newQuery.trim()]);
      setNewQuery("");
    }
  };

  const handleRemoveQuery = (index: number) => {
    setSearchQueries(searchQueries.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let locationToSave;
      if (locationPreference === "any") {
        locationToSave = { city: "any", latitude: 0, longitude: 0 };
      } else if (currentLocation) {
        locationToSave = currentLocation;
      } else {
        locationToSave = scout.location;
      }

      // Build scrape_options object
      const scrapeOptions: ScrapeOptions = {};
      if (cookies.trim()) {
        scrapeOptions.cookies = cookies.trim();
      }
      // Only save if there are options set
      const scrapeOptionsToSave = Object.keys(scrapeOptions).length > 0 ? scrapeOptions : null;

      const { error } = await supabase
        .from("scouts")
        .update({
          title,
          goal,
          description,
          search_queries: searchQueries,
          frequency,
          location: locationToSave,
          scrape_options: scrapeOptionsToSave,
        })
        .eq("id", scout.id);

      if (error) {
        console.error("Error saving scout:", error);
      } else {
        if (onScoutUpdate) {
          onScoutUpdate();
        }
        onOpenChange(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-24">
        <DialogHeader>
          <DialogTitle className="text-title-h5">
            Scout Configuration
          </DialogTitle>
          <DialogDescription className="text-body-medium">
            Edit settings for this scout
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-24 mt-24">
          {/* Active Toggle */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-label-medium text-gray-700">Active</h3>
              <Switch checked={isActive} onCheckedChange={handleActiveToggle} />
            </div>
          </div>

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-12">
              <label className="text-label-medium text-gray-700">Title</label>
              <button
                type="button"
                onClick={() =>
                  setEditMode({ ...editMode, title: !editMode.title })
                }
                className="p-6 hover:bg-gray-100 rounded-6 transition-colors"
              >
                <Pencil className="h-14 w-14 text-gray-500" />
              </button>
            </div>
            {editMode.title ? (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter scout title"
                className="w-full"
                autoFocus
              />
            ) : (
              <p className="text-body-medium text-gray-900 py-12 px-16 bg-gray-50 rounded-6 min-h-[44px] flex items-center">
                {title || <span className="text-gray-400 italic">Not set</span>}
              </p>
            )}
          </div>

          {/* Goal */}
          <div>
            <div className="flex items-center justify-between mb-12">
              <label className="text-label-medium text-gray-700">Goal</label>
              <button
                type="button"
                onClick={() =>
                  setEditMode({ ...editMode, goal: !editMode.goal })
                }
                className="p-6 hover:bg-gray-100 rounded-6 transition-colors"
              >
                <Pencil className="h-14 w-14 text-gray-500" />
              </button>
            </div>
            {editMode.goal ? (
              <Input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Enter scout goal"
                className="w-full"
                autoFocus
              />
            ) : (
              <p className="text-body-medium text-gray-900 py-12 px-16 bg-gray-50 rounded-6 min-h-[44px] flex items-center">
                {goal || <span className="text-gray-400 italic">Not set</span>}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-12">
              <label className="text-label-medium text-gray-700">
                Description
              </label>
              <button
                type="button"
                onClick={() =>
                  setEditMode({
                    ...editMode,
                    description: !editMode.description,
                  })
                }
                className="p-6 hover:bg-gray-100 rounded-6 transition-colors"
              >
                <Pencil className="h-14 w-14 text-gray-500" />
              </button>
            </div>
            {editMode.description ? (
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter scout description"
                className="w-full min-h-[100px]"
                autoFocus
              />
            ) : (
              <p className="text-body-medium text-gray-900 py-12 px-16 bg-gray-50 rounded-6 min-h-[100px] whitespace-pre-wrap">
                {description || (
                  <span className="text-gray-400 italic">Not set</span>
                )}
              </p>
            )}
          </div>

          {/* Location */}
          <div>
            <div className="flex items-center justify-between mb-12">
              <label className="text-label-medium text-gray-700">
                Location
              </label>
              <button
                type="button"
                onClick={() =>
                  setEditMode({ ...editMode, location: !editMode.location })
                }
                className="p-6 hover:bg-gray-100 rounded-6 transition-colors"
              >
                <Pencil className="h-14 w-14 text-gray-500" />
              </button>
            </div>
            {editMode.location ? (
              <div className="space-y-16 p-16 border-1 rounded-6">
                <div className="flex items-center gap-24">
                  <label className="flex items-center gap-10 cursor-pointer">
                    <input
                      type="radio"
                      name="location"
                      value="current"
                      checked={locationPreference === "current"}
                      onChange={(e) =>
                        setLocationPreference(
                          e.target.value as "current" | "any",
                        )
                      }
                      className="w-16 h-16 text-primary focus:ring-2 focus:ring-primary"
                    />
                    <span className="text-body-medium text-gray-700">
                      Current Location
                    </span>
                  </label>
                  <label className="flex items-center gap-10 cursor-pointer">
                    <input
                      type="radio"
                      name="location"
                      value="any"
                      checked={locationPreference === "any"}
                      onChange={(e) =>
                        setLocationPreference(
                          e.target.value as "current" | "any",
                        )
                      }
                      className="w-16 h-16 text-primary focus:ring-2 focus:ring-primary"
                    />
                    <span className="text-body-medium text-gray-700">
                      Any Location
                    </span>
                  </label>
                </div>
                {locationPreference === "current" && (
                  <div className="text-body-small text-gray-500 bg-gray-50 p-12 rounded-6">
                    {currentLocation ? (
                      <>
                        {currentLocation.city}
                        {currentLocation.state && `, ${currentLocation.state}`}
                        {currentLocation.country &&
                          `, ${currentLocation.country}`}
                      </>
                    ) : (
                      <span className="text-gray-400 italic">
                        Detecting location...
                      </span>
                    )}
                  </div>
                )}
                {locationPreference === "any" && (
                  <div className="text-body-small text-gray-500 bg-gray-50 p-12 rounded-6">
                    Anywhere
                  </div>
                )}
              </div>
            ) : (
              <p className="text-body-medium text-gray-900 py-12 px-16 bg-gray-50 rounded-6 min-h-[44px] flex items-center">
                {scout.location &&
                scout.location.latitude === 0 &&
                scout.location.longitude === 0 ? (
                  "Anywhere"
                ) : currentLocation ? (
                  <>
                    {currentLocation.city}
                    {currentLocation.state && `, ${currentLocation.state}`}
                    {currentLocation.country && `, ${currentLocation.country}`}
                  </>
                ) : scout.location ? (
                  <>
                    {scout.location.city}
                    {scout.location.state && `, ${scout.location.state}`}
                    {scout.location.country && `, ${scout.location.country}`}
                  </>
                ) : (
                  <span className="text-gray-400 italic">Not set</span>
                )}
              </p>
            )}
          </div>

          {/* Search Queries */}
          <div>
            <div className="flex items-center justify-between mb-12">
              <label className="text-label-medium text-gray-700">
                Search Queries{" "}
                {searchQueries.length > 0 && `(${searchQueries.length}/5)`}
              </label>
              <button
                type="button"
                onClick={() =>
                  setEditMode({
                    ...editMode,
                    searchQueries: !editMode.searchQueries,
                  })
                }
                className="p-6 hover:bg-gray-100 rounded-6 transition-colors"
              >
                <Pencil className="h-14 w-14 text-gray-500" />
              </button>
            </div>
            {editMode.searchQueries ? (
              <div className="space-y-12">
                {searchQueries.map((query, index) => (
                  <div key={index} className="flex items-center gap-12">
                    <Input
                      value={query}
                      onChange={(e) => {
                        const newQueries = [...searchQueries];
                        newQueries[index] = e.target.value;
                        setSearchQueries(newQueries);
                      }}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveQuery(index)}
                      className="flex-shrink-0"
                    >
                      <X className="h-16 w-16" />
                    </Button>
                  </div>
                ))}
                {searchQueries.length < 5 && (
                  <div className="flex items-center gap-12">
                    <Input
                      value={newQuery}
                      onChange={(e) => setNewQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddQuery();
                        }
                      }}
                      placeholder="Add a new search query (max 5)"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleAddQuery}
                      disabled={!newQuery.trim()}
                      className="flex-shrink-0"
                    >
                      <Plus className="h-16 w-16" />
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 px-16 bg-gray-50 rounded-6 min-h-[44px]">
                {searchQueries.length > 0 ? (
                  <ul className="space-y-8">
                    {searchQueries.map((query, index) => (
                      <li
                        key={index}
                        className="text-body-medium text-gray-900 flex items-start"
                      >
                        <span className="text-gray-400 mr-10">•</span>
                        {query}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body-medium text-gray-400 italic">
                    No search queries added yet
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Frequency */}
          <div>
            <div className="flex items-center justify-between mb-12">
              <label className="text-label-medium text-gray-700">
                Frequency
              </label>
              <button
                type="button"
                onClick={() =>
                  setEditMode({ ...editMode, frequency: !editMode.frequency })
                }
                className="p-6 hover:bg-gray-100 rounded-6 transition-colors"
              >
                <Pencil className="h-14 w-14 text-gray-500" />
              </button>
            </div>
            {editMode.frequency ? (
              <Select
                value={frequency || undefined}
                onValueChange={(value) =>
                  setFrequency(value as "daily" | "every_3_days" | "weekly")
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{frequencyLabels.daily}</SelectItem>
                  <SelectItem value="every_3_days">
                    {frequencyLabels.every_3_days}
                  </SelectItem>
                  <SelectItem value="weekly">
                    {frequencyLabels.weekly}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-body-medium text-gray-900 py-12 px-16 bg-gray-50 rounded-6 min-h-[44px] flex items-center">
                {frequency ? (
                  frequencyLabels[frequency]
                ) : (
                  <span className="text-gray-400 italic">Not set</span>
                )}
              </p>
            )}
          </div>

          {/* Cookies (Advanced) */}
          <div className="border-t pt-24">
            <div className="flex items-center justify-between mb-12">
              <div>
                <label className="text-label-medium text-gray-700">
                  Cookies
                </label>
                <p className="text-body-small text-gray-500 mt-2">
                  Optional: Send cookies when scraping websites (for authenticated content)
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setEditMode({ ...editMode, cookies: !editMode.cookies })
                }
                className="p-6 hover:bg-gray-100 rounded-6 transition-colors"
              >
                <Pencil className="h-14 w-14 text-gray-500" />
              </button>
            </div>
            {editMode.cookies ? (
              <Textarea
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                placeholder="session_id=abc123; auth_token=xyz789"
                className="w-full font-mono text-body-small"
                rows={3}
              />
            ) : (
              <p className="text-body-medium text-gray-900 py-12 px-16 bg-gray-50 rounded-6 min-h-[44px] flex items-center font-mono">
                {cookies ? (
                  <span className="truncate">{cookies.slice(0, 50)}{cookies.length > 50 ? '...' : ''}</span>
                ) : (
                  <span className="text-gray-400 italic font-sans">Not configured</span>
                )}
              </p>
            )}
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-12 pt-24 border-t">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
