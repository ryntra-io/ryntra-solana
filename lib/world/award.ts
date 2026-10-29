import { DISTRICTS, EVENT_KINDS, EVENT_SOURCES, type District, type EventKind, type EventSource, type PointsReason, type WorldEvent, type WorldVersion } from "./contract";
import { POINTS } from "./catalog";
import { isPointsReason } from "./rules";
import type { WorldStore } from "./store";

/**
 * What other parts of the server may do to the world, and nothing more: pay
 * points for a real step, put a market or engine event in the city's feed,
 * freeze the city of a day. No route reaches these; the server's own jobs
 * call them.
 *
 * Points: the amount comes from the list, never from the caller, and the key
 * makes a step pay once however often it is reported. There is no reason for
 * trading volume or for the number of launches, so neither can ever pay.
 */

export class WorldInputRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldInputRefused";
  }
}

const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length >= 1 && value.length <= max;

export async function awardPoints(store: WorldStore, input: Readonly<{ residentId: string; reason: PointsReason; sourceRef: string; key: string; now?: Date }>) {
  if (!isPointsReason(input.reason)) throw new WorldInputRefused(`no points for ${String(input.reason)}`);
  if (!text(input.sourceRef, 200) || !text(input.key, 200)) throw new WorldInputRefused("a source and a key of 1 to 200 characters");
  return store.award({ residentId: input.residentId, reason: input.reason, delta: POINTS[input.reason], sourceRef: input.sourceRef, key: input.key, now: input.now ?? new Date() });
}

export async function recordWorldEvent(store: WorldStore, input: Readonly<{
  source: Exclude<EventSource, "world">;
  kind: EventKind;
  subject: string;
  sourceAt: Date | null;
  district?: District | null;
  payload?: Record<string, unknown>;
  now?: Date;
}>): Promise<WorldEvent> {
  if (!(EVENT_SOURCES as readonly string[]).includes(input.source) || input.source === ("world" as string)) throw new WorldInputRefused("events of the world are written by its own routes");
  if (!(EVENT_KINDS as readonly string[]).includes(input.kind)) throw new WorldInputRefused("unknown event kind");
  if (!text(input.subject, 64)) throw new WorldInputRefused("a subject of 1 to 64 characters");
  if (input.district != null && !(DISTRICTS as readonly string[]).includes(input.district)) throw new WorldInputRefused("unknown district");
  if (input.sourceAt !== null && !Number.isFinite(input.sourceAt.getTime())) throw new WorldInputRefused("a source time or null");
  return store.recordEvent({ source: input.source, kind: input.kind, subject: input.subject, sourceAt: input.sourceAt, district: input.district ?? null, payload: input.payload ?? {}, now: input.now ?? new Date() });
}

export async function freezeWorldVersion(store: WorldStore, input: Readonly<{ day: string; seed: string; towers: unknown[]; now?: Date }>): Promise<{ created: boolean; version: WorldVersion }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || Number.isNaN(Date.parse(`${input.day}T00:00:00Z`))) throw new WorldInputRefused("a day is YYYY-MM-DD");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.seed)) throw new WorldInputRefused("a seed is 1 to 64 letters, digits, _ or -");
  if (!Array.isArray(input.towers)) throw new WorldInputRefused("towers is a list");
  return store.freezeVersion({ day: input.day, seed: input.seed, towers: input.towers, now: input.now ?? new Date() });
}
