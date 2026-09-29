/**
 * How the Spot page asks again when a read does not answer.
 *
 * Measured on production on 2026-09-14: the page's first market list and its
 * first market detail were refused together — a cold instance and a rate
 * limit that cleared within seconds — and the column stayed empty behind
 * *The market list is unavailable right now* until the person changed tab.
 * A read that fails is asked again on its own, quickly at first and then at a
 * steady pace while the tab is visible; the note appears only once the quick
 * retries have not helped, and it carries a button.
 */

export const SPOT_READ_RETRY_DELAYS_MS = [2_500, 6_000, 12_000] as const;
export const SPOT_READ_RETRY_STEADY_MS = 20_000;
/** The unavailable note is shown from this many consecutive failures on. */
export const SPOT_LIST_NOTICE_AFTER_FAILURES = 3;

/** Milliseconds to wait before the next attempt after `failures` consecutive failures (≥ 1). */
export function spotReadRetryDelayMs(failures: number): number {
  const count = Number.isSafeInteger(failures) && failures > 0 ? failures : 1;
  return SPOT_READ_RETRY_DELAYS_MS[count - 1] ?? SPOT_READ_RETRY_STEADY_MS;
}

/** Whether the list's unavailable note, rather than *Loading markets…*, is shown. */
export function spotListNoticeVisible(failures: number | undefined): boolean {
  return (failures ?? 0) >= SPOT_LIST_NOTICE_AFTER_FAILURES;
}

/**
 * A category list that came back empty because the verified universe did not
 * answer is a failed read, not an empty category: it must be asked again, and
 * the page must not print *No markets in this category* for it.
 */
export function spotListReadIncomplete(read: Readonly<{ view: string; searching: boolean; partial: boolean; rowCount: number }>): boolean {
  return read.partial && read.rowCount === 0 && !read.searching && read.view !== "all" && read.view !== "watchlist";
}
