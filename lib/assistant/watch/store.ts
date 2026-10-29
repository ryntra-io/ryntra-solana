/**
 * «Стежити за токеном» in the Guard store (AI-05) — one collection,
 * `assistantWatches`, no DDL.
 *
 * - `watch:solana:mainnet:<wallet>:<id>` — a person's watch: the token, the
 *   rule, paused or on, its pause between notes, its channels, its state
 *   (armed, since when, the last note); versioned, so the page and the pass
 *   never write over each other.
 * - `market:<mint>` — the token's latest read and its short history, shared
 *   by everyone who watches it; written by the pass only.
 * - `rate:solana:mainnet:<wallet>:<UTC hour>` — how many notes of the hour
 *   left on Telegram and push (≤ 20).
 * - `run:last` — what the last pass did.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import type { GuardStore } from "../../guard/store.ts";
import type { MintRead, Sample } from "./market.ts";
import { COOLDOWN_MAX_MINUTES, COOLDOWN_MIN_MINUTES, WatchRuleSchema } from "./rules.ts";

export const WATCHES_COLLECTION = "assistantWatches" as const;

const Wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Iso = z.string().datetime({ offset: true });

const FigureSchema = z.object({ value: z.number().finite(), beside: z.number().finite().nullable(), source: z.string().min(1).max(32), observedAt: Iso }).strict();

export const WatchRecordSchema = z
  .object({
    schema: z.literal("ryntra.assistant.watch"),
    version: z.number().int().min(1),
    id: z.string().regex(/^wch_[0-9a-f]{24}$/),
    owner: Wallet,
    mint: Wallet,
    symbol: z.string().min(1).max(32),
    rule: WatchRuleSchema,
    status: z.enum(["active", "paused"]),
    cooldownMinutes: z.number().int().min(COOLDOWN_MIN_MINUTES).max(COOLDOWN_MAX_MINUTES),
    channels: z.object({ telegram: z.boolean(), push: z.boolean() }).strict(),
    locale: z.enum(["en", "uk"]),
    state: z.object({ armed: z.boolean(), armedSince: Iso, lastFiredAt: Iso.nullable() }).strict(),
    /** The latest note: when, on what figure, and the note's id. */
    last: z.object({ at: Iso, figure: FigureSchema, inboxId: z.string().regex(/^inb_[0-9a-f]{24}$/) }).strict().nullable(),
    fired: z.number().int().min(0),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type WatchRecord = z.infer<typeof WatchRecordSchema>;

export type MarketRecord = Readonly<{
  schema: "ryntra.assistant.watch-market";
  version: number;
  mint: string;
  read: MintRead;
  samples: readonly Sample[];
  updatedAt: string;
}>;

export type WatchRun = Readonly<{
  at: string;
  watches: number;
  tokens: number;
  requests: Readonly<{ jupiter: number; dex: number }>;
  fired: number;
  delivered: number;
  capped: number;
  /** Alerts in the person's quiet hours: the inbox alone. */
  quiet: number;
  durationMs: number;
}>;

const PREFIX = "solana:mainnet:";
export const watchKey = (owner: string, id: string) => `watch:${PREFIX}${owner}:${id}`;
export const watchPrefix = (owner?: string) => (owner ? `watch:${PREFIX}${owner}:` : `watch:${PREFIX}`);
export const marketKey = (mint: string) => `market:${mint}`;
export const rateKey = (owner: string, hour: string) => `rate:${PREFIX}${owner}:${hour}`;
export const hourOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 13);

export function newWatchId(): string {
  return `wch_${randomBytes(12).toString("hex")}`;
}

type Versioned = { version: number };
const rows = (store: GuardStore) => store.versioned<Versioned & Record<string, unknown>>(WATCHES_COLLECTION);

function parseWatch(raw: unknown): WatchRecord | null {
  const parsed = WatchRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function readWatch(store: GuardStore, owner: string, id: string): Promise<WatchRecord | null> {
  const found = parseWatch(await rows(store).get(watchKey(owner, id)));
  return found && found.owner === owner ? found : null;
}

/** A wallet's watches, oldest first; or, without a wallet, every watch the pass reads. A record this code cannot read is skipped. */
export async function listWatches(store: GuardStore, owner?: string): Promise<WatchRecord[]> {
  const found = (await rows(store).valuesWithPrefix(watchPrefix(owner))).flatMap((row) => {
    const parsed = parseWatch(row);
    return parsed && (!owner || parsed.owner === owner) ? [parsed] : [];
  });
  return found.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/** Write over the version read (null — create); false when someone else wrote first. */
export async function writeWatch(store: GuardStore, next: WatchRecord, expected: number | null): Promise<boolean> {
  return rows(store).compareAndSet(watchKey(next.owner, next.id), expected, WatchRecordSchema.parse(next) as Versioned & Record<string, unknown>);
}

export async function deleteWatch(store: GuardStore, owner: string, id: string): Promise<void> {
  await rows(store).delete(watchKey(owner, id));
}

export async function readMarket(store: GuardStore, mint: string): Promise<MarketRecord | null> {
  const found = (await rows(store).get(marketKey(mint))) as unknown as MarketRecord | null;
  return found && found.schema === "ryntra.assistant.watch-market" && found.mint === mint ? found : null;
}

export async function writeMarket(store: GuardStore, next: MarketRecord, expected: number | null): Promise<boolean> {
  return rows(store).compareAndSet(marketKey(next.mint), expected, next as unknown as Versioned & Record<string, unknown>);
}

/** A token nobody watches any more: its history goes. */
export async function dropMarket(store: GuardStore, mint: string): Promise<void> {
  await rows(store).delete(marketKey(mint));
}

export async function listMarketMints(store: GuardStore): Promise<string[]> {
  return (await rows(store).valuesWithPrefix("market:")).flatMap((row) => (typeof row.mint === "string" ? [row.mint] : []));
}

/**
 * Take one of the hour's deliveries for a wallet: true while fewer than
 * `limit` were taken this hour. Compare-and-set, so two passes never both
 * take the twentieth.
 */
export async function takeDelivery(store: GuardStore, owner: string, nowMs: number, limit: number): Promise<boolean> {
  const key = rateKey(owner, hourOf(nowMs));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = (await rows(store).get(key)) as (Versioned & { count?: number }) | null;
    const count = typeof found?.count === "number" ? found.count : 0;
    if (count >= limit) return false;
    if (await rows(store).compareAndSet(key, found?.version ?? null, { version: (found?.version ?? 0) + 1, count: count + 1, owner, hour: hourOf(nowMs) })) return true;
  }
  /* A counter that kept changing under us: send rather than drop — the hour's 20 is a ceiling, not a reason to lose an alert. */
  return true;
}

export type DeliveryDecision = "send" | "capped" | "quiet" | "none";
export const deliveryKey = (owner: string, identity: string) => `deliver:${PREFIX}${owner}:${identity}`;

/**
 * What becomes of one crossing's deliveries, decided once and kept: a pass
 * retried after a crash reads the same decision and acts on it again, so a
 * note never loses its Telegram and push, and the hour's count is taken once.
 */
export async function claimDelivery(store: GuardStore, owner: string, identity: string, nowMs: number, input: Readonly<{ channels: boolean; quiet: boolean; limit: number }>): Promise<DeliveryDecision> {
  const key = deliveryKey(owner, identity);
  const kept = store.collection<{ key?: string; decision: DeliveryDecision; at: string }>(WATCHES_COLLECTION);
  const found = await kept.get(key);
  if (found) return found.decision;
  const decision: DeliveryDecision = !input.channels ? "none" : input.quiet ? "quiet" : (await takeDelivery(store, owner, nowMs, input.limit)) ? "send" : "capped";
  if (await kept.insertIfAbsent(key, { key, decision, at: new Date(nowMs).toISOString() })) return decision;
  return (await kept.get(key))?.decision ?? decision;
}

/** Delivery decisions older than two days go: a crossing is retried within minutes, not days. */
export async function pruneDeliveries(store: GuardStore, nowMs: number): Promise<void> {
  const kept = store.collection<{ key?: string; decision: DeliveryDecision; at: string }>(WATCHES_COLLECTION);
  const cut = new Date(nowMs - 2 * 86_400_000).toISOString();
  for (const row of await kept.valuesWithPrefix(`deliver:${PREFIX}`)) if (row.key && row.at < cut) await kept.delete(row.key);
}

/** The hour counters older than two hours go. */
export async function pruneRates(store: GuardStore, nowMs: number): Promise<number> {
  const cut = hourOf(nowMs - 2 * 3_600_000);
  let removed = 0;
  for (const row of await rows(store).valuesWithPrefix(`rate:${PREFIX}`)) {
    if (typeof row.hour === "string" && typeof row.owner === "string" && row.hour < cut) {
      await rows(store).delete(rateKey(row.owner, row.hour));
      removed += 1;
    }
  }
  return removed;
}

export async function writeRun(store: GuardStore, run: WatchRun): Promise<void> {
  await store.collection<WatchRun>(WATCHES_COLLECTION).set("run:last", run);
}

export async function readRun(store: GuardStore): Promise<WatchRun | null> {
  return (await store.collection<WatchRun>(WATCHES_COLLECTION).get("run:last")) ?? null;
}
