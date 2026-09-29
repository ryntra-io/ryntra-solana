import { parseExplicitInstant } from "../portfolio/freshness.ts";

/**
 * The brief's window, in its own module — and the reason is a bundle boundary.
 *
 * `daily-brief.ts` hashes its output with `node:crypto`, which is correct on a
 * server and fatal in a browser: the client island that reads the reader's
 * last-visit marker needs `briefWindow` and nothing else, and importing it from
 * the compiler dragged `node:crypto` into the client bundle. Webpack refused
 * it, the route rendered a build error, and neither the type checker nor the
 * test suite noticed — both run in Node, where `node:crypto` resolves.
 *
 * So the pure half lives here. Nothing in this file touches a clock, a
 * filesystem or a Node builtin, and it is safe on either side of the boundary.
 */

/** One day. The declared fallback when no visit marker exists. */
export const DEFAULT_BRIEF_WINDOW_SECONDS = 60 * 60 * 24;

export type BriefWindow = Readonly<{
  state: "SINCE_LAST_VISIT" | "DEFAULT_WINDOW" | "NOT_SERVER_READABLE";
  from: string | null;
  to: string;
  reason: string;
}>;

/**
 * Where the brief's start time came from, typed so it cannot be mistaken.
 *
 * `serverReadable: false` is the server-render answer: the marker lives in the
 * reader's own browser, so a server component genuinely does not know it and
 * says so instead of quietly falling back to a default that reads like a
 * measurement. The client island then calls this again with the real marker.
 */
export function briefWindow(input: Readonly<{
  lastSeenAt: string | null;
  asOf: string;
  defaultWindowSeconds: number;
  serverReadable?: boolean;
}>): BriefWindow {
  const asOfMs = parseExplicitInstant(input.asOf);
  if (asOfMs === null) throw new TypeError("briefWindow: asOf must be an explicit instant");

  if (input.serverReadable === false) {
    return {
      state: "NOT_SERVER_READABLE",
      from: null,
      to: input.asOf,
      reason: "When you last looked is held by this browser on this device, so a server render cannot read it.",
    };
  }

  const fallback = new Date(asOfMs - input.defaultWindowSeconds * 1000).toISOString();

  if (input.lastSeenAt === null) {
    return {
      state: "DEFAULT_WINDOW",
      from: fallback,
      to: input.asOf,
      reason: "No previous visit is recorded on this device, so the brief covers the default window.",
    };
  }

  const seen = parseExplicitInstant(input.lastSeenAt);
  if (seen === null) {
    return {
      state: "DEFAULT_WINDOW",
      from: fallback,
      to: input.asOf,
      reason: "The recorded visit marker is not a readable instant, so the brief covers the default window.",
    };
  }
  if (seen > asOfMs) {
    return {
      state: "DEFAULT_WINDOW",
      from: fallback,
      to: input.asOf,
      reason: "The recorded visit marker is in the future, so it is refused and the brief covers the default window.",
    };
  }

  return {
    state: "SINCE_LAST_VISIT",
    from: input.lastSeenAt,
    to: input.asOf,
    reason: "Since you last opened Home on this device.",
  };
}

