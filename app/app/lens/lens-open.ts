"use client";

import { useSyncExternalStore } from "react";

import { contextParam } from "@/lib/agent/context";
import type { AgentContext } from "@/lib/api/v1/contract";

/**
 * Whether the Brief and the Critic are open on a surface.
 *
 * The lens no longer opens by itself where a person is deciding: it waits
 * behind the page's own *Ask Ryn*. The press and the panel are two separate
 * components — the press sits beside the page's other actions, the panel
 * below the head — so the one fact they share lives here, keyed by the same
 * context string every *Ask Ryn* link already writes. Nothing is stored:
 * a reload starts closed.
 */

/** The one panel a surface draws; the press names it for assistive technology. */
export const LENS_PANEL_ID = "ryn-lens";

const open = new Set<string>();
const listeners = new Set<() => void>();

export function lensKey(subject: AgentContext): string {
  return contextParam(subject);
}

export function setLensOpen(key: string, value: boolean): void {
  if (value === open.has(key)) return;
  if (value) open.add(key);
  else open.delete(key);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLensOpen(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open.has(key),
    () => false,
  );
}
