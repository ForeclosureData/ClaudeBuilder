"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequestCountyForm({ prefill }: { prefill?: string }) {
  const [name, setName] = useState(prefill ?? "");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    const res = await fetch("/api/county-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedCountyName: name, requesterEmail: email || undefined }),
    });
    setStatus(res.ok ? "success" : "error");
  }

  if (status === "success") {
    return <p className="text-sm text-success-500">Thanks — we track every request when prioritizing new counties.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="County name" required className="sm:w-48" />
      <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email (optional, for updates)" className="sm:w-64" />
      <Button type="submit" disabled={status === "loading" || name.length < 2}>Request this county</Button>
    </form>
  );
}
