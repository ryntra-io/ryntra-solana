"use client";

import { useState } from "react";
import { CheckMark } from "@/app/components/mark";

/** Small clipboard button for the invite link (cabinet Beta Access page). */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the link row stays selectable */
    }
  };
  return (
    <button type="button" className="btn btn-ghost btn-sm cb-card-cta btn-ico-label" onClick={() => void copy()}>
      {copied ? <><CheckMark aria-label="copied" /> Copied</> : label}
    </button>
  );
}
