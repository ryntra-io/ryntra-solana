"use client";

import { useRef, useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    if (resetTimer.current) clearTimeout(resetTimer.current);

    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }

    resetTimer.current = setTimeout(() => setState("idle"), 2200);
  }

  const visibleLabel = state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label;

  return (
    <button className="acd-copy" type="button" onClick={copy} aria-label={`${label} to clipboard`}>
      <span aria-live="polite">{visibleLabel}</span>
    </button>
  );
}
