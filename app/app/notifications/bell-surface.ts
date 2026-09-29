import type { InboxRecord } from "@/lib/monitoring/store";

/** What the bell reads of the monitoring answer: the latest notes and how many of them are unread. */
export type BellSurface = Readonly<{ recent: readonly InboxRecord[]; unread: number }>;

/**
 * What the surface shows of the monitoring answer: every note but the prediction
 * demo's paper ones, which left the surface with the demo (canon v5.4 В32), and
 * the unread count of exactly those — never a count of notes the panel hides.
 * The service counts unread over the same list, so nothing is lost here.
 */
export function onSurface(surface: BellSurface): BellSurface {
  const recent = (surface.recent ?? []).filter((row) => !row.paper);
  return { recent, unread: recent.filter((row) => row.unread).length };
}
