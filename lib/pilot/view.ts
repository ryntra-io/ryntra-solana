/** CITY-204 — the plan as the city reads it (`GET /api/bots/pilot`): public data only. Pure. */

import type { PilotEntry } from "./book.server.ts";

export type PilotView = Readonly<{
  network: "devnet" | "mainnet";
  status: PilotEntry["status"];
  said: string | null;
  plan: PilotEntry["plan"];
  policy: string | null;
  legs: PilotEntry["legs"];
  held: PilotEntry["held"] | null;
  care: PilotEntry["care"] | null;
  events: PilotEntry["events"];
  createdAt: number;
}>;

export const viewOfPilot = (entry: PilotEntry): PilotView => ({
  network: entry.cluster,
  status: entry.status,
  said: entry.said,
  plan: entry.plan,
  policy: entry.policy,
  legs: entry.legs,
  held: entry.held ?? null,
  care: entry.care ?? null,
  events: entry.events.slice(-8),
  createdAt: entry.createdAt,
});
