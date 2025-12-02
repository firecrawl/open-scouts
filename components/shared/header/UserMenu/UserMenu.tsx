"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { User, LogOut, ChevronDown } from "lucide-react";
import Link from "next/link";
import Button from "../../button/Button";

export default function UserMenu() {
  const { user, isLoading, signOut } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    setIsOpen(false);
    router.push("/");
    router.refresh();
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="w-32 h-32 rounded-full bg-black-alpha-4 animate-pulse" />
    );
  }

  // Show login button if not authenticated
  if (!user) {
    return (
      <Link href="/login">
        <Button variant="secondary" size="default">
          Sign In
        </Button>
      </Link>
    );
  }

  // Get user initials or first letter of email
  const displayName = user.email?.split("@")[0] || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-8 px-12 py-6 rounded-8 hover:bg-black-alpha-4 transition-colors"
      >
        <div className="w-28 h-28 rounded-full bg-heat-100 flex items-center justify-center text-accent-white text-label-small font-medium">
          {initials}
        </div>
        <span className="text-label-medium text-accent-black max-w-120 truncate lg-max:hidden">
          {displayName}
        </span>
        <ChevronDown
          className={`w-16 h-16 text-black-alpha-48 transition-transform lg-max:hidden ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-8 w-200 bg-accent-white rounded-12 shadow-lg border border-border-muted overflow-hidden z-50"
          style={{
            boxShadow:
              "0px 4px 16px rgba(0, 0, 0, 0.08), 0px 0px 0px 1px rgba(0, 0, 0, 0.04)",
          }}
        >
          {/* User Info */}
          <div className="px-16 py-12 border-b border-border-faint">
            <p className="text-label-small text-accent-black truncate">
              {displayName}
            </p>
            <p className="text-body-small text-black-alpha-56 truncate">
              {user.email}
            </p>
          </div>

          {/* Menu Items */}
          <div className="py-8">
            <Link
              href="/scouts"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-12 px-16 py-10 hover:bg-black-alpha-4 transition-colors"
            >
              <User className="w-16 h-16 text-black-alpha-56" />
              <span className="text-body-medium text-accent-black">
                My Scouts
              </span>
            </Link>

            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-12 px-16 py-10 hover:bg-black-alpha-4 transition-colors text-left"
            >
              <LogOut className="w-16 h-16 text-black-alpha-56" />
              <span className="text-body-medium text-accent-black">
                Sign Out
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
