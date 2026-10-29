/**
 * «Стеження за гаманцями» (SOL-R4) — what is kept, in one Guard collection
 * (`walletWatch`, no DDL):
 * - `follow:solana:mainnet:<owner>` — the wallets one person follows, with a
 *   name, what to be told of and since when; versioned, so two tabs never
 *   lose each other's change;
 * - `activity:<wallet>` — a wallet's trades as the chain shows them, shared
 *   by everyone who follows or opens it: read once for all, extended only by
 *   what is new;
 * - `birth:<mint>` — a token's creator, creation time and block, the labels'
 *   ground;
 * - `told:<owner>:<wallet>` — the trades a person was already told of;
 * - `sent:<owner>:<hour>` — how many of the person's notes went out in an
 *   hour, so a wallet that trades all night is not a phone that rings all
 *   night.
 *
 * Reads only the chain and Jupiter; signs, sends and trades nothing.
 */

import { z } from "zod";

import type { GuardStore, GuardVersionedRecord } from "../guard/store.ts";
import type { WalletTrade } from "./trades.ts";

export const WALLET_WATCH_COLLECTION = "walletWatch" as const;
/** How many wallets one person follows. */
export const FOLLOW_LIMIT = 20;
/** How many trades a wallet's record keeps, newest first. */
export const TRADES_KEPT = 200;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isAddress(value: unknown): value is string {
  return typeof value === "string" && BASE58.test(value);
}

export const ALERT_MODES = ["all", "sells", "off"] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

const FollowSchema = z
  .object({
    address: z.string().regex(BASE58),
    name: z.string().min(1).max(32).nullable(),
    alerts: z.enum(ALERT_MODES),
    /** ISO time it was followed: no note about a trade from before. */
    since: z.string(),
    /** Followed as a token's creator: the token, so the list can say whose. */
    via: z.object({ mint: z.string().regex(BASE58), symbol: z.string().max(24) }).strict().nullable(),
  })
  .strict();
export type WalletFollow = z.infer<typeof FollowSchema>;

const FollowsSchema = z
  .object({
    schema: z.literal("ryntra.wallet-watch.follows"),
    version: z.number().int().positive(),
    owner: z.string().regex(BASE58),
    locale: z.enum(["en", "uk"]),
    wallets: z.array(FollowSchema).max(FOLLOW_LIMIT),
    updatedAt: z.string(),
  })
  .strict();
export type FollowsRecord = z.infer<typeof FollowsSchema>;

export type ActivityRecord = Readonly<{
  schema: "ryntra.wallet-watch.activity";
  version: number;
  wallet: string;
  /** Newest first, at most `TRADES_KEPT`. */
  trades: readonly WalletTrade[];
  /** The newest signature read: the next read asks only for what came after it. */
  newest: string | null;
  /** Signatures listed but not read yet (a node said no): asked again first next time. */
  pending: readonly string[];
  /** How many of the wallet's transactions were read, and the oldest one's time. */
  scanned: number;
  oldestAt: number | null;
  /** The read reached the wallet's very first transaction. */
  complete: boolean;
  /** Transactions between reads that were not read — a wallet faster than the read. */
  skipped: number;
  /** More came between two reads than one list holds (absent on records before it). */
  gap?: boolean;
  /** What the wallet holds of each mint now, whole tokens, and when that was read. */
  held: Readonly<Record<string, number>> | null;
  heldAt: string | null;
  readAt: string;
}>;

export type BirthRecord = Readonly<{
  schema: "ryntra.wallet-watch.birth";
  version: number;
  mint: string;
  creator: string | null;
  createdAt: number | null;
  /** The creation's block: read only when a first buy was early; undefined until then, null when it could not be read. */
  createdSlot?: number | null;
  checkedAt: string;
}>;

type Row = GuardVersionedRecord & Record<string, unknown>;
const rows = (store: GuardStore) => store.versioned<Row>(WALLET_WATCH_COLLECTION);

export const followKey = (owner: string) => `follow:solana:mainnet:${owner}`;
export const activityKey = (wallet: string) => `activity:${wallet}`;
export const birthKey = (mint: string) => `birth:${mint}`;
const hourOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 13);
const sentKey = (owner: string, nowMs: number) => `sent:${owner}:${hourOf(nowMs)}`;

/* --------------------------------------------------------------- follows */

export async function readFollows(store: GuardStore, owner: string): Promise<FollowsRecord | null> {
  const found = await rows(store).get(followKey(owner));
  const parsed = FollowsSchema.safeParse(found);
  return parsed.success && parsed.data.owner === owner ? parsed.data : null;
}

export async function listFollows(store: GuardStore): Promise<FollowsRecord[]> {
  const found = await rows(store).valuesWithPrefix("follow:solana:mainnet:");
  return found.flatMap((row) => {
    const parsed = FollowsSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export type FollowChange =
  | Readonly<{ kind: "add"; follow: WalletFollow; alertsGiven?: boolean }>
  | Readonly<{ kind: "update"; address: string; name?: string | null; alerts?: AlertMode }>
  | Readonly<{ kind: "remove"; address: string }>;

export type FollowOutcome = Readonly<{ ok: true; record: FollowsRecord }> | Readonly<{ ok: false; code: "LIMIT" | "NOT_FOUND" | "CONFLICT" }>;

/** One change to the person's list, by compare-and-set, re-read and re-applied on a lost race (a second tab). */
export async function changeFollows(store: GuardStore, owner: string, change: FollowChange, locale: "en" | "uk", nowIso: string): Promise<FollowOutcome> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = await readFollows(store, owner);
    const wallets = [...(found?.wallets ?? [])];
    const at = wallets.findIndex((row) => row.address === (change.kind === "add" ? change.follow.address : change.address));
    if (change.kind === "add") {
      /* Followed again: kept where it was, the newer name and choice taken — the time it was first followed stays. */
      if (at >= 0) {
        const row = wallets[at]!;
        const alerts = change.alertsGiven === false ? row.alerts : change.follow.alerts;
        wallets[at] = { ...row, name: change.follow.name ?? row.name, alerts, since: row.alerts === "off" && alerts !== "off" ? nowIso : row.since, via: row.via ?? change.follow.via };
      }
      else if (wallets.length >= FOLLOW_LIMIT) return { ok: false, code: "LIMIT" };
      else wallets.unshift(change.follow);
    } else if (at < 0) {
      return { ok: false, code: "NOT_FOUND" };
    } else if (change.kind === "remove") {
      wallets.splice(at, 1);
    } else {
      const row = wallets[at]!;
      const alerts = change.alerts ?? row.alerts;
      /* Alerts turned back on: news from now on, never the trades of the hours they were off. */
      wallets[at] = { ...row, name: change.name === undefined ? row.name : change.name, alerts, since: row.alerts === "off" && alerts !== "off" ? nowIso : row.since };
    }
    const next: FollowsRecord = FollowsSchema.parse({ schema: "ryntra.wallet-watch.follows", version: (found?.version ?? 0) + 1, owner, locale, wallets, updatedAt: nowIso });
    if (await rows(store).compareAndSet(followKey(owner), found?.version ?? null, next as unknown as Row)) return { ok: true, record: next };
  }
  return { ok: false, code: "CONFLICT" };
}

/* -------------------------------------------------------------- activity */

export async function readActivity(store: GuardStore, wallet: string): Promise<ActivityRecord | null> {
  const found = (await rows(store).get(activityKey(wallet))) as unknown as ActivityRecord | undefined;
  return found && found.schema === "ryntra.wallet-watch.activity" && found.wallet === wallet ? found : null;
}

/** A newer read written over the one it extended; a lost race leaves the winner's — the next read extends that. */
export async function writeActivity(store: GuardStore, next: ActivityRecord, expected: number | null): Promise<boolean> {
  return rows(store).compareAndSet(activityKey(next.wallet), expected, next as unknown as Row);
}

export async function readBirth(store: GuardStore, mint: string): Promise<BirthRecord | null> {
  const found = (await rows(store).get(birthKey(mint))) as unknown as BirthRecord | undefined;
  return found && found.schema === "ryntra.wallet-watch.birth" && found.mint === mint ? found : null;
}

export async function writeBirth(store: GuardStore, next: BirthRecord, expected: number | null): Promise<boolean> {
  return rows(store).compareAndSet(birthKey(next.mint), expected, next as unknown as Row);
}

/* ------------------------------------------------------------ deliveries */

/** The trades of a wallet a person was told of, by key, of the last hours — a note never twice, a late one still told. */
const toldKey = (owner: string, wallet: string) => `told:${owner}:${wallet}`;
export const TOLD_KEPT = 300;

export async function readTold(store: GuardStore, owner: string, wallet: string): Promise<Readonly<{ version: number; keys: readonly string[] }> | null> {
  const found = (await rows(store).get(toldKey(owner, wallet))) as (Row & { keys?: unknown }) | undefined;
  return found && Array.isArray(found.keys) ? { version: found.version, keys: found.keys.filter((key): key is string => typeof key === "string") } : null;
}

export async function writeTold(store: GuardStore, owner: string, wallet: string, keys: readonly string[], expected: number | null): Promise<boolean> {
  return rows(store).compareAndSet(toldKey(owner, wallet), expected, { version: (expected ?? 0) + 1, keys: [...keys], owner, wallet });
}

/** A wallet no longer followed: what it was told of is forgotten, so following it again starts afresh. */
export async function forgetTold(store: GuardStore, owner: string, wallet: string): Promise<void> {
  await rows(store).delete(toldKey(owner, wallet));
}

/**
 * The records nobody needs any more: a wallet's trades that nobody follows and nobody opened for a day, and a token's
 * birth not looked at for a week. A followed wallet's record stays — the next read extends it.
 */
export async function pruneStale(store: GuardStore, followed: ReadonlySet<string>, nowMs: number): Promise<number> {
  let pruned = 0;
  for (const row of await rows(store).valuesWithPrefix("activity:")) {
    const record = row as unknown as Partial<ActivityRecord>;
    if (typeof record.wallet !== "string" || followed.has(record.wallet)) continue;
    if (nowMs - Date.parse(record.readAt ?? "") < 24 * 3_600_000) continue;
    await rows(store).delete(activityKey(record.wallet));
    pruned += 1;
  }
  for (const row of await rows(store).valuesWithPrefix("birth:")) {
    const record = row as unknown as Partial<BirthRecord>;
    if (typeof record.mint !== "string" || nowMs - Date.parse(record.checkedAt ?? "") < 7 * 24 * 3_600_000) continue;
    await rows(store).delete(birthKey(record.mint));
    pruned += 1;
  }
  return pruned;
}

/** Notes sent out to one person in an hour; past it, the rest stay in the inbox. */
export const SENT_PER_HOUR = 20;

/** Count one note out for the hour; false when the hour's share is spent. */
export async function claimSend(store: GuardStore, owner: string, nowMs: number): Promise<boolean> {
  const key = sentKey(owner, nowMs);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = (await rows(store).get(key)) as (Row & { count?: number }) | undefined;
    const count = typeof found?.count === "number" ? found.count : 0;
    if (count >= SENT_PER_HOUR) return false;
    if (await rows(store).compareAndSet(key, found?.version ?? null, { version: (found?.version ?? 0) + 1, count: count + 1, owner, hour: hourOf(nowMs) })) return true;
  }
  return false;
}

/**
 * Reads of a wallet from the chain per minute across every instance — the public read's cost, bounded: a first read
 * (up to thirty transactions) has its own share, a refresh of a wallet already kept (only what is new) another, so
 * open pages polling never take the share of a person looking a wallet up.
 */
export const CHAIN_READS_PER_MINUTE = { first: 30, refresh: 120 } as const;
const budgetKey = (kind: "first" | "refresh", nowMs: number) => `budget:${kind}:${new Date(nowMs).toISOString().slice(0, 16)}`;

/** Count one read of a wallet from the chain this minute; false when the minute's share is spent. */
export async function claimChainRead(store: GuardStore, nowMs: number, kind: "first" | "refresh" = "first", limit: number = CHAIN_READS_PER_MINUTE[kind]): Promise<boolean> {
  const key = budgetKey(kind, nowMs);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = (await rows(store).get(key)) as (Row & { count?: number }) | undefined;
    const count = typeof found?.count === "number" ? found.count : 0;
    if (count >= limit) return false;
    if (await rows(store).compareAndSet(key, found?.version ?? null, { version: (found?.version ?? 0) + 1, count: count + 1, kind, minute: key.slice(`budget:${kind}:`.length) })) return true;
  }
  return false;
}

/** The hours' counts older than a day, forgotten. */
export async function pruneSent(store: GuardStore, nowMs: number): Promise<number> {
  const all = await rows(store).valuesWithPrefix("sent:");
  const cutoff = hourOf(nowMs - 24 * 3_600_000);
  let pruned = 0;
  const minuteCutoff = new Date(nowMs - 3_600_000).toISOString().slice(0, 16);
  for (const row of await rows(store).valuesWithPrefix("budget:")) {
    const minute = typeof row.minute === "string" ? row.minute : null;
    const kind = row.kind === "refresh" ? "refresh" : "first";
    if (!minute || minute >= minuteCutoff) continue;
    await rows(store).delete(`budget:${kind}:${minute}`);
    pruned += 1;
  }
  for (const row of all) {
    const owner = typeof row.owner === "string" ? row.owner : null;
    const hour = typeof row.hour === "string" ? row.hour : null;
    if (!owner || !hour || hour >= cutoff) continue;
    await rows(store).delete(`sent:${owner}:${hour}`);
    pruned += 1;
  }
  return pruned;
}
