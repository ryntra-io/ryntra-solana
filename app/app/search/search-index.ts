"use client";

import { isSearchIndex, type SearchIndex } from "@/lib/search/product-search";

/**
 * The market index (`/api/search`) read once per visit and shared: the
 * search in the top bar and Home's «Що рухається сьогодні» read the same
 * answer — the lists Markets draws. A failed read is asked again next time
 * rather than remembered.
 */

let indexRead: Promise<SearchIndex | null> | null = null;

export function readSearchIndex(): Promise<SearchIndex | null> {
  if (!indexRead) {
    indexRead = fetch("/api/search", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => (isSearchIndex(body) ? body : null))
      .catch(() => null)
      .then((index) => {
        if (!index) indexRead = null;
        return index;
      });
  }
  return indexRead;
}
