import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

/**
 * Wallet presence — the two facts that happen before any money moves.
 *
 * The action ledger begins when money moves, so it cannot say how many wallets
 * opened the cabinet and never traded, nor which of them proved ownership.
 * Those are the first two steps of the business funnel, and this is the one
 * row per wallet that records them:
 *
 * - **seen** — the cabinet read this wallet's history, which is the request a
 *   connected wallet always makes. A read within thirty minutes of the last
 *   one is the same session; a later one is a return.
 * - **verified** — the wallet signed a proof of ownership on `/api/auth/solana`.
 *
 * Nothing else is stored: no IP, no user agent, no device, no locale, nothing
 * a person did not already publish by presenting the address. The row is an
 * index and never a boundary, and every writer here is non-fatal and bounded
 * by a deadline — a slow analytics write can shorten the admin's picture and
 * can never slow down a person's page.
 *
 * Measured from the first row written: there is no earlier history and none
 * is invented. The surface says *measured since* the earliest row.
 */

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const COLLECTION = "walletPresence" as const;
const SESSION_GAP_MS = 30 * 60_000;
const DEADLINE_MS = 1_500;

export const WalletPresenceSchema = z
  .object({
    schema: z.literal("ryntra.wallet-presence"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(0),
    network: z.literal("mainnet"),
    wallet: z.string().regex(BASE58_ADDRESS),
    firstSeenAt: z.string().datetime({ offset: true }),
    lastSeenAt: z.string().datetime({ offset: true }),
    /** Cabinet sessions, thirty minutes apart at least. */
    sessions: z.number().int().min(0),
    firstVerifiedAt: z.string().datetime({ offset: true }).nullable(),
    lastVerifiedAt: z.string().datetime({ offset: true }).nullable(),
    verifications: z.number().int().min(0),
  })
  .strict();

export type WalletPresenceRecord = z.output<typeof WalletPresenceSchema>;

export function walletPresenceKey(wallet: string): string {
  return `solana:mainnet:${wallet}:`;
}

export const WALLET_PRESENCE_PREFIX = "solana:mainnet:";

type PresenceOutcome = "recorded" | "unchanged" | "refused" | "unavailable";

async function withDeadline<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), DEADLINE_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function advance(
  store: GuardStore,
  wallet: string,
  next: (current: WalletPresenceRecord | null) => WalletPresenceRecord | null,
): Promise<PresenceOutcome> {
  if (!BASE58_ADDRESS.test(wallet)) return "refused";
  const key = walletPresenceKey(wallet);
  const work = (async (): Promise<PresenceOutcome> => {
    try {
      const collection = store.versioned<WalletPresenceRecord>(COLLECTION);
      return await withBoundedCasRetry(async () => {
        const raw = await collection.get(key);
        const parsed = raw === undefined ? null : WalletPresenceSchema.safeParse(raw);
        const current = parsed && parsed.success ? parsed.data : null;
        const candidate = next(current);
        if (candidate === null) return "unchanged" as const;
        const record = WalletPresenceSchema.parse({ ...candidate, version: current ? current.version + 1 : 0 });
        const wrote = await collection.compareAndSet(key, current ? current.version : null, record);
        return wrote ? ("recorded" as const) : false;
      });
    } catch {
      return "unavailable";
    }
  })();
  return withDeadline(work, "unavailable");
}

function fresh(wallet: string, now: string): WalletPresenceRecord {
  return {
    schema: "ryntra.wallet-presence",
    schemaVersion: "1.0.0",
    version: 0,
    network: "mainnet",
    wallet,
    firstSeenAt: now,
    lastSeenAt: now,
    sessions: 1,
    firstVerifiedAt: null,
    lastVerifiedAt: null,
    verifications: 0,
  };
}

/** The cabinet read this wallet. Never throws; never takes longer than the deadline. */
export async function recordWalletSeen(store: GuardStore, args: Readonly<{ wallet: string; now: string }>): Promise<PresenceOutcome> {
  return advance(store, args.wallet, (current) => {
    if (!current) return fresh(args.wallet, args.now);
    const gap = Date.parse(args.now) - Date.parse(current.lastSeenAt);
    /* A read a moment after the last is the same session and is not written
       at all, which is also what keeps a busy cabinet from writing on every
       refresh. */
    if (Number.isFinite(gap) && gap >= 0 && gap < SESSION_GAP_MS) return null;
    return { ...current, lastSeenAt: args.now, sessions: current.sessions + 1 };
  });
}

/** The wallet proved ownership. A proof is also a visit. */
export async function recordWalletVerified(store: GuardStore, args: Readonly<{ wallet: string; now: string }>): Promise<PresenceOutcome> {
  return advance(store, args.wallet, (current) => {
    const base = current ?? fresh(args.wallet, args.now);
    return {
      ...base,
      lastSeenAt: base.lastSeenAt > args.now ? base.lastSeenAt : args.now,
      firstVerifiedAt: base.firstVerifiedAt ?? args.now,
      lastVerifiedAt: args.now,
      verifications: base.verifications + 1,
    };
  });
}

export type WalletPresenceRead =
  | Readonly<{ status: "measured"; rows: readonly WalletPresenceRecord[] }>
  | Readonly<{ status: "unavailable" }>;

/** Every wallet ever seen. Rows that do not parse are dropped rather than guessed at. */
export async function listWalletPresence(store: GuardStore): Promise<WalletPresenceRead> {
  try {
    const raw = await store.collection<unknown>(COLLECTION).valuesWithPrefix(WALLET_PRESENCE_PREFIX);
    const rows: WalletPresenceRecord[] = [];
    for (const row of raw) {
      const parsed = WalletPresenceSchema.safeParse(row);
      if (parsed.success) rows.push(parsed.data);
    }
    return { status: "measured", rows };
  } catch {
    return { status: "unavailable" };
  }
}
