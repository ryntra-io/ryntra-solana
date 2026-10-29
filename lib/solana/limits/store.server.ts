/**
 * The limits lane's own record of every order Ryntra relayed: what was asked,
 * the fee the chain wrote, and each signature in its life — placed, filled,
 * cancelled. One versioned row per order in the Guard store's
 * `solanaLimitOrders` collection, keyed `<network>:<wallet>:<venue>:<order>`.
 *
 * Its own collection rather than a new lane in `solanaWalletActions`: that
 * lane list is part of the public API v1 and of the phone's decoder, and a
 * lane they do not know has twice turned a wallet's whole history into «could
 * not be loaded» (`action-lanes.ts`). A limit order is also not one action: it
 * lives for days and ends in one of three ways.
 *
 * Never throws to a money path: a write that fails returns a reason for a log.
 */

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../../guard/store.ts";
import { LIMIT_SIDES, LIMIT_VENUES } from "./model.ts";

const COLLECTION = "solanaLimitOrders" as const;

export const LIMIT_ORDER_STATES = ["PLACING", "OPEN", "PARTIAL", "FILLED", "CANCELLING", "CANCELLED", "EXPIRED", "FAILED"] as const;
export type LimitOrderState = (typeof LIMIT_ORDER_STATES)[number];
/** States in which the order is settled for good; the reconciler leaves them alone. */
export const FINAL_LIMIT_STATES: ReadonlySet<LimitOrderState> = new Set(["FILLED", "CANCELLED", "EXPIRED", "FAILED"]);

const Raw = z.string().regex(/^\d+$/);
const Signature = z.string().min(32).max(100);

const FillSchema = z.object({
  signature: Signature,
  inputRaw: Raw,
  outputRaw: Raw,
  feeRaw: Raw,
  at: z.string(),
});

export const LimitOrderRecordSchema = z.object({
  schema: z.literal("ryntra.solana.limit-order"),
  schemaVersion: z.literal("1.0.0"),
  version: z.number().int().positive(),
  network: z.literal("mainnet"),
  wallet: z.string().min(32).max(44),
  venue: z.enum(LIMIT_VENUES),
  order: z.string().min(32).max(44),
  pool: z.string().nullable(),
  side: z.enum(LIMIT_SIDES),
  baseMint: z.string(),
  quoteMint: z.string(),
  inputMint: z.string(),
  outputMint: z.string(),
  makingRaw: Raw,
  takingRaw: Raw,
  /** Quote per base as the person typed it, and the price the venue will actually fill at. */
  price: z.string(),
  fillPrice: z.number().nullable(),
  fee: z.object({ ryntraBps: z.number().int().min(0), venueBps: z.number().int().min(0), account: z.string().nullable() }),
  state: z.enum(LIMIT_ORDER_STATES),
  placeSignature: Signature.nullable(),
  cancelSignature: Signature.nullable(),
  fills: z.array(FillSchema),
  /** While a cancellation is in flight: the state it left, restored if the cancellation never lands. */
  cancelFrom: z.enum(LIMIT_ORDER_STATES).nullable().default(null),
  /** A DLMM claim in flight: what had converted, read before the relay — the fill a receipt shows, even if the request dies. */
  claim: z.object({ inputRaw: Raw, outputRaw: Raw }).nullable().default(null),
  reason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type LimitOrderRecord = z.output<typeof LimitOrderRecordSchema>;
export type LimitOrderFill = z.output<typeof FillSchema>;

export function limitOrderKey(args: Readonly<{ wallet: string; venue: string; order: string }>): string {
  return `mainnet:${args.wallet}:${args.venue}:${args.order}`;
}

export type LimitRecordInput = Omit<LimitOrderRecord, "schema" | "schemaVersion" | "version" | "network" | "createdAt" | "updatedAt" | "cancelFrom" | "claim"> &
  Partial<Pick<LimitOrderRecord, "cancelFrom" | "claim">>;

/** Create the row before the bytes go out — a relay that lands with no row behind it is the one loss this lane can make. */
export async function beginLimitOrder(store: GuardStore, input: LimitRecordInput, now: string): Promise<Readonly<{ ok: true; record: LimitOrderRecord }> | Readonly<{ ok: false; reason: string }>> {
  const parsed = LimitOrderRecordSchema.safeParse({ cancelFrom: null, claim: null, ...input, schema: "ryntra.solana.limit-order", schemaVersion: "1.0.0", version: 1, network: "mainnet", createdAt: now, updatedAt: now });
  if (!parsed.success) return { ok: false, reason: "LIMIT_RECORD_MALFORMED" };
  try {
    const wrote = await store.versioned<LimitOrderRecord>(COLLECTION).compareAndSet(limitOrderKey(input), null, parsed.data);
    return wrote ? { ok: true, record: parsed.data } : { ok: false, reason: "LIMIT_RECORD_EXISTS" };
  } catch (failure) {
    return { ok: false, reason: failure instanceof Error ? failure.message : "LIMIT_STORE_UNAVAILABLE" };
  }
}

export async function readLimitOrder(store: GuardStore, key: string): Promise<LimitOrderRecord | null> {
  try {
    const raw = await store.collection<unknown>(COLLECTION).get(key);
    const parsed = LimitOrderRecordSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Advance one row with a pure step; a step that returns null leaves it as it is. */
export async function advanceLimitOrder(
  store: GuardStore,
  key: string,
  step: (record: LimitOrderRecord) => Partial<LimitRecordInput> | null,
  now: string,
): Promise<Readonly<{ ok: true; record: LimitOrderRecord }> | Readonly<{ ok: false; reason: string }>> {
  const collection = store.versioned<LimitOrderRecord>(COLLECTION);
  try {
    return await withBoundedCasRetry(async () => {
      const existing = await readLimitOrder(store, key);
      if (!existing) return { ok: false as const, reason: "LIMIT_RECORD_MISSING" };
      const change = step(existing);
      if (change === null) return { ok: true as const, record: existing };
      const next = LimitOrderRecordSchema.safeParse({ ...existing, ...change, version: existing.version + 1, updatedAt: now });
      if (!next.success) return { ok: false as const, reason: "LIMIT_RECORD_MALFORMED" };
      const wrote = await collection.compareAndSet(key, existing.version, next.data);
      if (!wrote) return false;
      return { ok: true as const, record: next.data };
    });
  } catch (failure) {
    return { ok: false, reason: failure instanceof Error ? failure.message : "LIMIT_STORE_UNAVAILABLE" };
  }
}

/** A wallet's rows, newest first. Malformed rows are dropped and counted, never guessed. */
export async function listLimitOrders(store: GuardStore, wallet: string): Promise<Readonly<{ records: readonly LimitOrderRecord[]; complete: boolean }>> {
  const rows = await store.collection<unknown>(COLLECTION).valuesWithPrefix(`mainnet:${wallet}:`);
  const records: LimitOrderRecord[] = [];
  let complete = true;
  for (const row of rows) {
    const parsed = LimitOrderRecordSchema.safeParse(row);
    if (parsed.success) records.push(parsed.data);
    else complete = false;
  }
  records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { records, complete };
}

/**
 * Every row not yet final, across wallets — what the reconciler reads: the
 * submissions without an answer first, then the open orders, longest
 * untouched first, so no number of open orders can crowd a placement out.
 */
export async function listUnsettledLimitOrders(store: GuardStore): Promise<readonly LimitOrderRecord[]> {
  const rows = await store.collection<unknown>(COLLECTION).valuesWithPrefix("mainnet:");
  const inFlight = (state: LimitOrderState) => (state === "PLACING" || state === "CANCELLING" ? 0 : 1);
  return rows
    .map((row) => LimitOrderRecordSchema.safeParse(row))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data as LimitOrderRecord)
    .filter((record) => !FINAL_LIMIT_STATES.has(record.state))
    .sort((a, b) => inFlight(a.state) - inFlight(b.state) || a.updatedAt.localeCompare(b.updatedAt));
}

/** Fills merged by signature: a venue that reports a fill twice records it once. */
export function mergeFills(existing: readonly LimitOrderFill[], incoming: readonly LimitOrderFill[]): LimitOrderFill[] {
  const bySignature = new Map(existing.map((fill) => [fill.signature, fill]));
  for (const fill of incoming) if (!bySignature.has(fill.signature)) bySignature.set(fill.signature, fill);
  return [...bySignature.values()].sort((a, b) => a.at.localeCompare(b.at));
}
