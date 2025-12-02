"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/shared/button/Button";
import { Mail, Lock, Loader2 } from "lucide-react";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/";
  const pendingQuery = searchParams.get("pendingQuery") || "";

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const supabase = createClient();

  // Check if already logged in
  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        // If there's a pending query, go back to home to process it
        if (pendingQuery) {
          router.push(`/?pendingQuery=${encodeURIComponent(pendingQuery)}`);
        } else {
          router.push(redirectTo);
        }
      }
    };
    checkSession();
  }, [supabase, router, redirectTo, pendingQuery]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setMessage("");

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;

        // Redirect after login
        if (pendingQuery) {
          router.push(`/?pendingQuery=${encodeURIComponent(pendingQuery)}`);
        } else {
          router.push(redirectTo);
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}&pendingQuery=${encodeURIComponent(pendingQuery)}`,
          },
        });
        if (error) throw error;
        setMessage("Check your email for the confirmation link!");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setIsLoading(true);
    setError("");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}&pendingQuery=${encodeURIComponent(pendingQuery)}`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-16 py-48">
      <div
        className="w-full max-w-400 bg-accent-white rounded-16 p-32"
        style={{
          boxShadow:
            "0px 0px 44px 0px rgba(0, 0, 0, 0.02), 0px 88px 56px -20px rgba(0, 0, 0, 0.03), 0px 56px 56px -20px rgba(0, 0, 0, 0.02), 0px 32px 32px -20px rgba(0, 0, 0, 0.03), 0px 16px 24px -12px rgba(0, 0, 0, 0.03), 0px 0px 0px 1px rgba(0, 0, 0, 0.05)",
        }}
      >
        {/* Header */}
        <div className="text-center mb-32">
          <h1 className="text-title-h4 text-accent-black mb-8">
            {isLogin ? "Welcome back" : "Create an account"}
          </h1>
          <p className="text-body-medium text-black-alpha-56">
            {isLogin
              ? "Sign in to continue creating scouts"
              : "Sign up to start creating AI scouts"}
          </p>
        </div>

        {/* Google OAuth Button */}
        <button
          onClick={handleGoogleAuth}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-12 px-16 py-12 rounded-8 border border-border-muted bg-accent-white hover:bg-black-alpha-4 transition-colors text-label-medium text-accent-black disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="w-20 h-20">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-16 my-24">
          <div className="flex-1 h-1 bg-border-faint" />
          <span className="text-label-small text-black-alpha-48">or</span>
          <div className="flex-1 h-1 bg-border-faint" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailAuth} className="space-y-16">
          <div>
            <label className="block text-label-small text-black-alpha-56 mb-8">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-12 top-1/2 -translate-y-1/2 w-18 h-18 text-black-alpha-48" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full pl-40 pr-12 py-12 rounded-8 border border-border-muted bg-accent-white text-body-input text-accent-black placeholder:text-black-alpha-48 focus:outline-none focus:ring-2 focus:ring-heat-100/20 focus:border-heat-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-label-small text-black-alpha-56 mb-8">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-12 top-1/2 -translate-y-1/2 w-18 h-18 text-black-alpha-48" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full pl-40 pr-12 py-12 rounded-8 border border-border-muted bg-accent-white text-body-input text-accent-black placeholder:text-black-alpha-48 focus:outline-none focus:ring-2 focus:ring-heat-100/20 focus:border-heat-100"
              />
            </div>
          </div>

          {error && (
            <div className="p-12 rounded-8 bg-accent-crimson/10 border border-accent-crimson/20">
              <p className="text-body-small text-accent-crimson">{error}</p>
            </div>
          )}

          {message && (
            <div className="p-12 rounded-8 bg-accent-forest/10 border border-accent-forest/20">
              <p className="text-body-small text-accent-forest">{message}</p>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="large"
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-8 px-16 py-8">
                <Loader2 className="w-18 h-18 animate-spin" />
                Loading...
              </div>
            ) : (
              <div className="px-16 py-8">
                {isLogin ? "Sign In" : "Sign Up"}
              </div>
            )}
          </Button>
        </form>

        {/* Toggle Login/Signup */}
        <div className="mt-24 text-center">
          <p className="text-body-small text-black-alpha-56">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError("");
                setMessage("");
              }}
              className="text-heat-100 hover:underline font-medium"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-32 h-32 animate-spin text-heat-100" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
