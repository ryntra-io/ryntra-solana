/**
 * Markets' tabs (canon v5.4 В33, 2026-09-24): Усі · Компанії · Приватні ·
 * Крипта · Меми · Долари, in the Owner's order. A plain module, so the server
 * page can read `?tab=` and the client tabs can draw it from one list.
 */

export const MARKETS_TABS = ["all", "companies", "private", "crypto", "memes", "dollars"] as const;

export type MarketsTab = (typeof MARKETS_TABS)[number];

export function isMarketsTab(value: unknown): value is MarketsTab {
  return typeof value === "string" && (MARKETS_TABS as readonly string[]).includes(value);
}
