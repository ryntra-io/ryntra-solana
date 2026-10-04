"use client";

import { Sparkle } from "@phosphor-icons/react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AgentContext } from "@/lib/api/v1/contract";

import styles from "./lens.module.css";
import { LENS_PANEL_ID, lensKey, setLensOpen, useLensOpen } from "./lens-open";

/**
 * The page's own *Ask Ryn* where the page also draws the Brief and the
 * Critic: the same words and the same place as `AskRyn`, but the press opens
 * the block on this page (`LensPanel` with `trigger="page"`) instead of
 * leaving it. The conversation stays one press further, inside the opened
 * block. `variant="link"` draws it as a line in a list of facts, where a
 * button would shout.
 */
export function AskRynLens({ subject, locale, variant = "button", className }: { subject: AgentContext; locale: WorkspaceLocale; variant?: "button" | "link"; className?: string }) {
  const key = lensKey(subject);
  const open = useLensOpen(key);
  const label = locale === "uk" ? "Спитати Ryntra" : "Ask Ryntra";
  return (
    <button type="button" className={className ?? (variant === "link" ? undefined : `rw-btn ${styles.ask}`)} aria-expanded={open} aria-controls={LENS_PANEL_ID} data-ask-ryn={subject.kind} onClick={() => setLensOpen(key, !open)}>
      {variant === "link" ? null : <Sparkle size={16} weight="bold" aria-hidden="true" />}
      <span>{variant === "link" ? `${label} →` : label}</span>
    </button>
  );
}
