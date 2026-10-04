"use client";

/**
 * The buy card's anchors, shared by the page's *Buy* and the card's own
 * actions: the card a *Buy* brings a person to, the one orange action
 * inside it that *Buy* watches so a screen never shows two, and the event
 * the card announces when that action is drawn anew — a preset chosen, a
 * wallet connected or confirmed — so *Buy* watches the element that is on
 * the page now.
 */
export const BUY_PANEL_ID = "buy";
export const BUY_REVIEW_ID = "buy-review";
export const BUY_ACTIONS_EVENT = "ryntra:stock-buy-actions";

export function announceBuyActions(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BUY_ACTIONS_EVENT));
}
