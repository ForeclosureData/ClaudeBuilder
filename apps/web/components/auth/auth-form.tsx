"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Mode = "sign-in" | "sign-up" | "reset";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage(null);

    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch (err) {
      setStatus("error");
      setMessage(
        "This demo environment has no Supabase project configured yet. Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web/.env to enable sign-in.",
      );
      return;
    }

    if (mode === "sign-up") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }

      const plan = searchParams.get("plan");
      if (data.session && plan) {
        const internalPlanId = plan === "unlimited" ? "texas_monthly" : "county_monthly";
        const checkoutRes = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ internalPlanId }),
        });
        if (checkoutRes.ok) {
          const { url } = await checkoutRes.json();
          window.location.href = url;
          return;
        }
      }

      setStatus("success");
      setMessage(
        data.session
          ? "Account created — head to Pricing to start your trial."
          : "Check your email to confirm your account.",
      );
      return;
    }

    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/settings/billing`,
      });
      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }
      setStatus("success");
      setMessage("Check your email for a password reset link.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    router.push(searchParams.get("next") ?? "/properties");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {mode !== "reset" && (
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}
      {message && (
        <p className={`text-sm ${status === "error" ? "text-danger-500" : "text-success-500"}`}>{message}</p>
      )}
      <Button type="submit" className="w-full" disabled={status === "loading"}>
        {status === "loading"
          ? "Please wait…"
          : mode === "sign-up"
            ? "Create account"
            : mode === "reset"
              ? "Send reset link"
              : "Sign in"}
      </Button>
    </form>
  );
}
