"use client";

import { useSyncExternalStore } from "react";

import type { AgentContext } from "@/lib/api/v1/contract";

/**
 * Whether the assistant's side panel is open, and what it was opened about
 * (AI-06a). The header's button and «Пояснити рух» on a token's page are two
 * presses far from the one panel the frame draws, so the one fact they share
 * lives here, the way the lens shares its own (`lens-open.ts`). Nothing is
 * stored: a reload starts closed.
 *
 * `ask` is a question to put to Ryntra as the panel opens — «Що зрушило ціну
 * JUP?» from the press beside the price. Every opening is a new `seq`, so the
 * same press twice asks again rather than reusing a closed panel's state.
 *
 * AI-06: `tab` is the tab the panel opens on — «Стежити» on a token opens
 * «Стежу» with that token chosen, «План» opens «Плани»; null is the
 * conversation.
 */

export const ASSISTANT_PANEL_ID = "ryntra-assistant-panel";

/** The panel's and the page's tabs (AI-06; AI-20 — «Доручення» its own): Розмова · Стежу · Доручення · Плани · Огляди · Кредити. */
export type AssistantTab = "chat" | "watch" | "tasks" | "plans" | "brief" | "credits";
export type AssistantRequest = Readonly<{ context: AgentContext | null; ask: string | null; tab: AssistantTab | null; seq: number }>;
export type AssistantPanelState = Readonly<{ open: boolean; request: AssistantRequest }>;

let state: AssistantPanelState = { open: false, request: { context: null, ask: null, tab: null, seq: 0 } };
const listeners = new Set<() => void>();

function publish(next: AssistantPanelState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Open the panel about `context`; with `ask`, the question goes to Ryntra as it opens; with `tab`, on that tab. */
export function openAssistant(context: AgentContext | null, ask: string | null = null, tab: AssistantTab | null = null): void {
  publish({ open: true, request: { context, ask, tab, seq: state.request.seq + 1 } });
}

export function closeAssistant(): void {
  if (state.open) publish({ ...state, open: false });
}

/** The header's button: open about the screen, or close what is open. */
export function toggleAssistant(context: AgentContext | null): void {
  if (state.open) closeAssistant();
  else openAssistant(context);
}

/**
 * Whether a question a press put to the panel is asked by itself: only while the line under the field would say
 * «безкоштовно» — `shown` is the price the client may send (`shownPrice`): 0 while the day's free credits pay,
 * undefined where there are no credits, the full price once the balance would pay. Never from the balance unasked.
 */
export function asksByItself(autoAsk: boolean, shown: number | undefined): boolean {
  return autoAsk && !shown;
}

/** The state as it is now — for a press outside React and for the tests. */
export function readAssistantPanel(): AssistantPanelState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const CLOSED: AssistantPanelState = state;

export function useAssistantPanel(): AssistantPanelState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => CLOSED,
  );
}
