"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";

export function CorrectionReportForm({ propertyId, foreclosureCaseId }: { propertyId?: string; foreclosureCaseId?: string }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function submit() {
    setStatus("loading");
    const res = await fetch("/api/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, foreclosureCaseId, description }),
    });
    setStatus(res.ok ? "success" : "error");
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Report incorrect information
      </Button>
    );
  }

  if (status === "success") {
    return <p className="text-sm text-success-500">Thank you — your report was submitted for review.</p>;
  }

  return (
    <div className="max-w-md space-y-2">
      <Label>What's incorrect?</Label>
      <textarea
        className="w-full rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. This sale was postponed on 8/15 — the county site now shows a new date."
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={description.length < 10 || status === "loading"}>
          Submit report
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {status === "error" && <p className="text-sm text-danger-500">Something went wrong — please try again.</p>}
    </div>
  );
}
