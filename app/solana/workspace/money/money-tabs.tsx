"use client";

/**
 * Retired with the menu v6.2 (2026-10-06): a section's pages
 * are tabs the shell draws at the top of each of them (`app/shell/section-tabs.tsx`)
 * — Гроші is Поповнити · Надіслати · Отримати · Між мережами, and Винагороди
 * keeps its own. The export stays, drawing nothing, until the pages of the
 * Growth line that still import it drop the import on their side.
 */

export type MoneyJob = "send" | "receive" | "rewards";

export function MoneyTabs(_props: { current: MoneyJob }) {
  return null;
}
