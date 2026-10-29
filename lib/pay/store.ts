/**
 * Payment requests — persistence over the Guard durable store.
 *
 * Same generic CAS table the wallet action ledger lives in, five collection
 * names (see `GUARD_COLLECTIONS`), no DDL. Keys:
 *
 *   paymentRequests            <id>
 *   paymentRequestOwners       <network>:<wallet>:<createdAt>:<id>   (wallet-first, scannable)
 *   paymentRequestSettlements  <id>
 *   paymentRequestReferences   <reference>  → { id }
 *   paymentIntents             <intentId>
 *   paymentAttempts            <id>   (versioned: the one payment on its way, `attempt.ts`)
 *
 * The owner index is the only place a wallet is a key, and it is read only by
 * the proof-gated listing. A public read never touches it.
 */

import type { GuardStore } from "../guard/store.ts";
import {
  PaymentRequestOwnerSchema,
  PaymentRequestRecordSchema,
  PaymentRequestSettlementSchema,
  type PaymentRequestOwner,
  type PaymentRequestRecord,
  type PaymentRequestSettlement,
} from "./model.ts";

const REQUESTS = "paymentRequests" as const;
const OWNERS = "paymentRequestOwners" as const;
const SETTLEMENTS = "paymentRequestSettlements" as const;
const REFERENCES = "paymentRequestReferences" as const;
const INTENTS = "paymentIntents" as const;

type ReferenceIndex = Readonly<{ id: string }>;

export type PaymentIntentRecord = Readonly<{
  schema: "ryntra.pay.intent";
  schemaVersion: "1.0.0";
  intentId: string;
  requestId: string;
  payer: string;
  /** `0x`-prefixed SHA-256 of the compiled message the payer was handed. */
  messageHash: string;
  /** The exact unsigned bytes handed out, so a wallet's own additions can be compared instruction by instruction. */
  unsignedWireBase64: string;
  amountRaw: string;
  mint: string | null;
  createdAt: string;
  expiresAt: string;
  /** Set once these bytes crossed the broadcast boundary; a second submit is refused. */
  signature: string | null;
}>;

export function ownerKey(owner: Pick<PaymentRequestOwner, "network" | "wallet" | "createdAt" | "id">): string {
  return `${owner.network}:${owner.wallet}:${owner.createdAt}:${owner.id}`;
}

export function ownerPrefix(args: Readonly<{ network: string; wallet: string }>): string {
  return `${args.network}:${args.wallet}:`;
}

/**
 * Create the three records. The reference index is claimed first with
 * `insertIfAbsent`, so two requests can never share a reference even across
 * instances; the public id is claimed the same way. A lost claim is reported,
 * not retried here — the caller draws fresh randomness and tries again.
 *
 * `owner: null` (AI-12): a request no wallet's listing shows — the assistant's
 * order of credits, paid to Ryntra's treasury; the order is its private side.
 */
export async function createPaymentRequest(
  store: GuardStore,
  args: Readonly<{ request: PaymentRequestRecord; owner: PaymentRequestOwner | null }>,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; reason: "ID_TAKEN" | "REFERENCE_TAKEN" | "STORE_FAILED" }>> {
  try {
    const references = store.collection<ReferenceIndex>(REFERENCES);
    const claimedReference = await references.insertIfAbsent(args.request.reference, { id: args.request.id });
    if (!claimedReference) return { ok: false, reason: "REFERENCE_TAKEN" };
    const requests = store.collection<PaymentRequestRecord>(REQUESTS);
    const claimedId = await requests.insertIfAbsent(args.request.id, args.request);
    if (!claimedId) {
      await references.delete(args.request.reference);
      return { ok: false, reason: "ID_TAKEN" };
    }
    if (args.owner) await store.collection<PaymentRequestOwner>(OWNERS).set(ownerKey(args.owner), args.owner);
    return { ok: true };
  } catch {
    return { ok: false, reason: "STORE_FAILED" };
  }
}

export async function readPaymentRequest(store: GuardStore, id: string): Promise<PaymentRequestRecord | null> {
  const raw = await store.collection<unknown>(REQUESTS).get(id);
  if (raw === undefined || raw === null) return null;
  const parsed = PaymentRequestRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function readPaymentSettlement(store: GuardStore, id: string): Promise<PaymentRequestSettlement | null> {
  const raw = await store.collection<unknown>(SETTLEMENTS).get(id);
  if (raw === undefined || raw === null) return null;
  const parsed = PaymentRequestSettlementSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writePaymentSettlement(store: GuardStore, settlement: PaymentRequestSettlement): Promise<void> {
  const parsed = PaymentRequestSettlementSchema.parse(settlement);
  await store.collection<PaymentRequestSettlement>(SETTLEMENTS).set(parsed.id, parsed);
}

/** Every request a proven wallet created, newest first. Private; proof-gated by the caller. */
export async function listPaymentRequestsByWallet(
  store: GuardStore,
  args: Readonly<{ network: string; wallet: string }>,
): Promise<readonly PaymentRequestOwner[]> {
  const rows = await store.collection<unknown>(OWNERS).valuesWithPrefix(ownerPrefix(args));
  const owners: PaymentRequestOwner[] = [];
  for (const row of rows) {
    const parsed = PaymentRequestOwnerSchema.safeParse(row);
    if (parsed.success) owners.push(parsed.data);
  }
  return owners.sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0));
}

export async function readRequestIdByReference(store: GuardStore, reference: string): Promise<string | null> {
  const raw = await store.collection<ReferenceIndex>(REFERENCES).get(reference);
  return raw && typeof raw.id === "string" ? raw.id : null;
}

export async function createPaymentIntent(store: GuardStore, intent: PaymentIntentRecord): Promise<boolean> {
  return store.collection<PaymentIntentRecord>(INTENTS).insertIfAbsent(intent.intentId, intent);
}

export async function readPaymentIntent(store: GuardStore, intentId: string): Promise<PaymentIntentRecord | null> {
  const raw = await store.collection<PaymentIntentRecord>(INTENTS).get(intentId);
  return raw && raw.schema === "ryntra.pay.intent" ? raw : null;
}

/** `null` (MC-1): bytes the node refused before it took them — the intent may be signed and sent again. */
export async function markPaymentIntentSubmitted(store: GuardStore, intent: PaymentIntentRecord, signature: string | null): Promise<void> {
  await store.collection<PaymentIntentRecord>(INTENTS).set(intent.intentId, { ...intent, signature });
}
