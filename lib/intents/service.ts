/**
 * The life of a prepared action (CITY-161): made by an agent, a chat or a partner; read by the city's sheet; claimed by
 * the one wallet that presses (the bound one, when the intent names a wallet); ended by that wallet's receipt — or let
 * go when the wallet said no and nothing was signed, or withdrawn by its creator before anyone claimed it. Every step
 * after the read names the digest the sheet was shown, so a person only ever acts on exactly what they saw, and every
 * change is compare-and-set on the record's version.
 *
 * Nothing here builds, signs or sends a transaction, and nothing here prices one: the swap engine builds the exact
 * transaction for the person's own wallet from the frozen fields, accepts back only the bytes it built and pinned, and
 * sends them once. Ryntra never signs for the person.
 *
 * Phase 1 (the engineering review of 31.10, M1): every beneficiary is the signer, and a transfer to another address
 * prepared by an outside client is closed unless the deployment opens it (`transfers`). The creator's key — shown once
 * when the intent is made — is what reads the receipt back and what withdraws the intent; anyone with the link sees only
 * where it stands.
 *
 * Pure apart from its deps (the store, the clock, the random source and the chain read).
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { digestHolds, intentDigest } from "./digest.ts";
import {
  CLAIM_LEASE_MS,
  CREATOR_KEY,
  DIGEST,
  INTENT_EXPIRY,
  INTENT_ID,
  INTENT_NETWORK,
  INTENT_SCHEMA,
  INTENT_SCHEMA_VERSION,
  OPEN_PER_WALLET,
  PAY_MINTS,
  SIGNATURE,
  swapLeg,
  isSolanaAddress,
  originNameRefusal,
  specRefusal,
  statusOf,
  type IntentBody,
  type IntentOrigin,
  type IntentRecord,
  type IntentSpec,
  type IntentStatus,
  type ReceiptChain,
} from "./model.ts";
import { IntentStoreUnavailable, type IntentChange, type IntentStore } from "./store.ts";

/** What a landed transaction did to one wallet: its lamports (it pays the fee) and its tokens by mint, raw. */
export type WalletMoves = Readonly<{
  /** Lamports before and after, and the fee the transaction paid. */
  lamports: Readonly<{ pre: bigint; post: bigint; fee: bigint }>;
  /** Token balances the wallet owns, by mint, before and after. */
  tokens: ReadonlyMap<string, Readonly<{ pre: bigint; post: bigint }>>;
}>;

/** What the chain says of a receipt's signature. */
export type ChainRead =
  /** The transaction landed; `failed` when it landed with an error (only its fee moved). */
  | Readonly<{ state: "LANDED"; feePayer: string; failed: boolean; blockTime: number | null; moves: WalletMoves }>
  /** No node has seen it (yet). */
  | Readonly<{ state: "UNSEEN" }>
  /** The chain could not be read. */
  | Readonly<{ state: "UNREADABLE" }>;

export type IntentDeps = Readonly<{
  store: IntentStore;
  now: () => Date;
  /** A fresh unguessable id (`INTENT_ID`). */
  newId: () => string;
  /** A fresh creator key (`CREATOR_KEY`). */
  newKey: () => string;
  /** Reads a receipt's signature on chain; null on a stand without a chain, where receipts are recorded `UNCHECKED`. */
  chain: ((signature: string) => Promise<ChainRead>) | null;
  /** Whether outside clients may prepare a transfer to another address (phase 1: no, unless the owner opens it). */
  transfers: boolean;
  /** Checks a wallet's signed bytes (`./signed.ts`). */
  readSigned: SignedReader;
}>;

export type IntentCode =
  | "VALIDATION_ERROR"
  | "INTENT_ORIGIN_REFUSED"
  | "INTENT_ACTION_CLOSED"
  | "INTENT_LIMIT"
  | "INTENT_NOT_FOUND"
  | "INTENT_EXPIRED"
  | "INTENT_CANCELLED"
  | "INTENT_USED"
  | "INTENT_BUSY"
  | "INTENT_CHANGED"
  | "INTENT_WRONG_WALLET"
  | "INTENT_NOT_CLAIMED"
  | "INTENT_RECEIPT_UNSEEN"
  | "INTENT_RECEIPT_MISMATCH"
  | "INTENT_KEY_INVALID"
  | "INTENT_SENT"
  | "INTENT_SIGNATURE_INVALID"
  | "UNAVAILABLE"
  /** The store is not provisioned on this deployment (the migration has not run): a capability it lacks, not a fault. */
  | "CAPABILITY_UNAVAILABLE";

export type IntentRefusal = Readonly<{ ok: false; code: IntentCode; message: string }>;
export type IntentAnswer = Readonly<{ ok: true; record: IntentRecord; status: IntentStatus }> | IntentRefusal;
/** A read: `creator` when the request carried the creator's key — only then is the receipt served. */
export type IntentRead = Readonly<{ ok: true; record: IntentRecord; status: IntentStatus; creator: boolean }> | IntentRefusal;
/** A new intent and the creator's key, which is shown here once and kept nowhere. */
export type IntentMade = Readonly<{ ok: true; record: IntentRecord; status: IntentStatus; creatorKey: string }> | IntentRefusal;

export type CreateInput = Readonly<{ spec: IntentSpec; origin: IntentOrigin; for?: string | null; expiresIn?: number | null }>;
export type StepInput = Readonly<{ digest: string; wallet: string }>;
export type ReceiptInput = StepInput & Readonly<{ signature: string }>;
/** The wallet's signed bytes, handed over before they can leave: the mark that this claim may now send. */
/**
 * `replaces`: the mark the city saw on this claim when the press began (null for none). The mark is compare-and-set on
 * it, so a second tab or device can never swap out a signature that may be on its way.
 */
export type MarkInput = StepInput & Readonly<{ signedWireBase64: string; replaces?: string | null }>;
/** Reads signed bytes: who pays and the first signature, only when that payer's ed25519 signature holds. */
export type SignedReader = (wireBase64: string) => Readonly<{ ok: true; signature: string; feePayer: string }> | Readonly<{ ok: false; reason: string }>;

const refuse = (code: IntentCode, message: string): IntentRefusal => ({ ok: false, code, message });

const MESSAGES = {
  notFound: "No such intent.",
  changed: "This intent is not the one that was shown. Nothing was changed.",
  expired: "This intent has expired.",
  cancelled: "Its creator withdrew this intent.",
  used: "This intent was already used.",
  busy: "Another wallet is confirming this intent.",
  wrongWallet: "This intent is for another wallet.",
  sent: "A signature of this intent is on its way. Read it back; do not sign again.",
  key: "The creator's key does not match.",
  unavailable: "Intents could not be reached. Nothing was changed.",
} as const;

const answer = (record: IntentRecord, now: Date): IntentAnswer => ({ ok: true, record, status: statusOf(record, now) });
const changeOf = (record: IntentRecord): IntentChange => ({ claim: record.claim, receipt: record.receipt, cancelledAt: record.cancelledAt });

export const hashKey = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");

/** Whether a key is the creator's, compared in constant time. */
function keyMatches(record: IntentRecord, key: string | null | undefined): boolean {
  if (!key || !CREATOR_KEY.test(key)) return false;
  const given = Buffer.from(hashKey(key), "hex");
  const kept = Buffer.from(record.creatorKeyHash, "hex");
  return given.length === kept.length && timingSafeEqual(given, kept);
}

/** Runs a store call; an unreachable store is UNAVAILABLE, never «not found». */
async function guarded<T extends Readonly<{ ok: boolean }>>(run: () => Promise<T | IntentRefusal>): Promise<T | IntentRefusal> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof IntentStoreUnavailable) {
      return error.reason === "NOT_PROVISIONED" ? refuse("CAPABILITY_UNAVAILABLE", "Intents are not served on this deployment yet.") : refuse("UNAVAILABLE", MESSAGES.unavailable);
    }
    throw error;
  }
}

export async function createIntent(deps: IntentDeps, input: CreateInput): Promise<IntentMade> {
  const why = specRefusal(input.spec);
  if (why) return refuse("VALIDATION_ERROR", why);
  if (input.spec.action === "transfer" && !deps.transfers) {
    return refuse("INTENT_ACTION_CLOSED", "A transfer to another address cannot be prepared from outside Ryntra yet.");
  }
  const named = originNameRefusal(input.origin.name);
  if (named === "SHAPE") return refuse("VALIDATION_ERROR", "origin.name: up to 32 plain letters, digits, spaces, dots, dashes or underscores.");
  if (named === "RESERVED") return refuse("INTENT_ORIGIN_REFUSED", "origin.name: this name is not yours to use.");
  const bound = input.for ?? null;
  if (bound !== null && !isSolanaAddress(bound)) return refuse("VALIDATION_ERROR", "for: the wallet this intent is for.");
  if (bound !== null && input.spec.action === "transfer" && input.spec.to === bound) return refuse("VALIDATION_ERROR", "to: a transfer from a wallet to itself moves nothing.");
  const seconds = input.expiresIn ?? INTENT_EXPIRY.defaultSeconds;
  if (!Number.isInteger(seconds) || seconds < INTENT_EXPIRY.minSeconds || seconds > INTENT_EXPIRY.maxSeconds) {
    return refuse("VALIDATION_ERROR", `expiresIn: whole seconds from ${INTENT_EXPIRY.minSeconds} to ${INTENT_EXPIRY.maxSeconds}.`);
  }
  return guarded<IntentMade>(async () => {
    const now = deps.now();
    if (bound !== null && (await deps.store.openFor(bound, now)) >= OPEN_PER_WALLET) {
      return refuse("INTENT_LIMIT", `This wallet already has ${OPEN_PER_WALLET} open intents.`);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = deps.newId();
      const creatorKey = deps.newKey();
      if (!INTENT_ID.test(id) || !CREATOR_KEY.test(creatorKey)) throw new Error("newId/newKey: not an intent id or key");
      const body: IntentBody = {
        schema: INTENT_SCHEMA,
        schemaVersion: INTENT_SCHEMA_VERSION,
        id,
        network: INTENT_NETWORK,
        spec: input.spec,
        origin: { kind: input.origin.kind, name: input.origin.name },
        for: bound,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
      };
      const record: IntentRecord = { body, digest: intentDigest(body), creatorKeyHash: hashKey(creatorKey), version: 0, claim: null, receipt: null, cancelledAt: null };
      if (await deps.store.insert(record)) return { ok: true, record, status: statusOf(record, now), creatorKey };
    }
    return refuse("UNAVAILABLE", MESSAGES.unavailable);
  });
}

/** The record, only while its frozen fields still match their digest. */
async function load(deps: IntentDeps, id: string): Promise<IntentRecord | IntentRefusal> {
  if (!INTENT_ID.test(id)) return refuse("INTENT_NOT_FOUND", MESSAGES.notFound);
  const record = await deps.store.read(id);
  if (!record || record.body.id !== id) return refuse("INTENT_NOT_FOUND", MESSAGES.notFound);
  if (!digestHolds(record)) return refuse("INTENT_CHANGED", MESSAGES.changed);
  return record;
}

/** Where it stands, for anyone with the id; the receipt only with the creator's key. */
export async function readIntent(deps: IntentDeps, id: string, key: string | null = null): Promise<IntentRead> {
  return guarded<IntentRead>(async () => {
    const loaded = await load(deps, id);
    if ("ok" in loaded) return loaded;
    return { ok: true, record: loaded, status: statusOf(loaded, deps.now()), creator: keyMatches(loaded, key) };
  });
}

function stepRefusal(input: StepInput): IntentRefusal | null {
  if (!DIGEST.test(input.digest)) return refuse("VALIDATION_ERROR", "digest: the intent's digest, as it was read.");
  if (!isSolanaAddress(input.wallet)) return refuse("VALIDATION_ERROR", "wallet: the signing wallet's address.");
  return null;
}

/**
 * One change on the record, decided on what it is now and written only while it still is: a lost race reads again and
 * decides again, a few times, then gives up as busy.
 */
async function change(
  deps: IntentDeps,
  id: string,
  check: (record: IntentRecord) => IntentRefusal | null,
  decide: (record: IntentRecord, status: IntentStatus, now: Date) => Promise<IntentChange | IntentAnswer>,
): Promise<IntentAnswer> {
  return guarded<IntentAnswer>(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const loaded = await load(deps, id);
      if ("ok" in loaded) return loaded;
      const refused = check(loaded);
      if (refused) return refused;
      const now = deps.now();
      const decided = await decide(loaded, statusOf(loaded, now), now);
      if ("ok" in decided) return decided;
      const written = await deps.store.update(id, loaded.version, decided);
      if (written.ok) return answer(written.record, deps.now());
      if (written.reason === "SIGNATURE_TAKEN") return refuse("INTENT_RECEIPT_MISMATCH", "This signature already answers another intent.");
    }
    return refuse("INTENT_BUSY", MESSAGES.busy);
  });
}

/** A step a person takes: named by the digest the sheet showed, from a wallet the intent allows. */
function step(deps: IntentDeps, id: string, input: StepInput, decide: Parameters<typeof change>[3]): Promise<IntentAnswer> {
  const malformed = stepRefusal(input);
  if (malformed) return Promise.resolve(malformed);
  return change(
    deps,
    id,
    (record) => {
      if (record.digest !== input.digest) return refuse("INTENT_CHANGED", MESSAGES.changed);
      if (record.body.for !== null && record.body.for !== input.wallet) return refuse("INTENT_WRONG_WALLET", MESSAGES.wrongWallet);
      return null;
    },
    decide,
  );
}

const ended = (status: IntentStatus): IntentRefusal | null =>
  status === "DONE" || status === "LAPSED" ? refuse("INTENT_USED", MESSAGES.used) : status === "CANCELLED" ? refuse("INTENT_CANCELLED", MESSAGES.cancelled) : null;

/**
 * The pressing wallet takes the intent for a short lease that ends at the intent's deadline at the latest; it is never
 * renewed, so nobody holds an intent by pressing again. The same wallet pressing again gets its claim back as it is —
 * once its signed bytes marked it, with the signature to read back, never a fresh start.
 */
export function claimIntent(deps: IntentDeps, id: string, input: StepInput): Promise<IntentAnswer> {
  return step(deps, id, input, async (record, status, now) => {
    const over = ended(status);
    if (over) return over;
    if (status === "EXPIRED") return refuse("INTENT_EXPIRED", MESSAGES.expired);
    if (status === "CLAIMED") return record.claim?.wallet === input.wallet ? answer(record, now) : refuse("INTENT_BUSY", MESSAGES.busy);
    const until = Math.min(now.getTime() + CLAIM_LEASE_MS, Date.parse(record.body.expiresAt));
    return { claim: { wallet: input.wallet, until: new Date(until).toISOString(), signature: null }, receipt: null, cancelledAt: null };
  });
}

/**
 * The claiming wallet's signed bytes, handed over by the city before the swap engine may send them: the server checks
 * that this wallet pays for them and signed them, and keeps the signature as the claim's mark. Bytes rebuilt after the
 * engine refused the earlier ones before its submit boundary (or the chain said they never left) mark it again with
 * their own signature — the city replaces a mark only then, and only the claiming wallet's own signed bytes can.
 */
export function markIntent(deps: IntentDeps, id: string, input: MarkInput): Promise<IntentAnswer> {
  const read = deps.readSigned(input.signedWireBase64);
  if (!read.ok) return Promise.resolve(refuse("INTENT_SIGNATURE_INVALID", "These bytes are not signed by a wallet that pays for them."));
  if (read.feePayer !== input.wallet) return Promise.resolve(refuse("INTENT_SIGNATURE_INVALID", "These bytes are paid by another wallet."));
  return step(deps, id, input, async (record, status, now) => {
    const over = ended(status);
    if (over) return over;
    if (status !== "CLAIMED") return refuse("INTENT_NOT_CLAIMED", "Confirm the intent before its bytes are signed.");
    if (record.claim?.wallet !== input.wallet) return refuse("INTENT_BUSY", MESSAGES.busy);
    if (record.claim.signature === read.signature) return answer(record, now);
    // Only the mark this press began from may be replaced: another tab's signature may be on its way.
    if (record.claim.signature !== (input.replaces ?? null)) return refuse("INTENT_SENT", MESSAGES.sent);
    return { ...changeOf(record), claim: { ...record.claim, signature: read.signature } };
  });
}

/**
 * The wallet said no, or the engine refused before anything was signed: the claim is let go and the intent is open
 * again for the rest of its time. Only the claiming wallet lets go, and only while its lease lives.
 */
export function releaseIntent(deps: IntentDeps, id: string, input: StepInput): Promise<IntentAnswer> {
  return step(deps, id, input, async (record, status, now) => {
    const over = ended(status);
    if (over) return over;
    if (status === "OPEN" || status === "EXPIRED") return answer(record, now);
    if (record.claim?.wallet !== input.wallet) return refuse("INTENT_BUSY", MESSAGES.busy);
    // Bytes of this claim may have left: it is never let go, only read back and receipted (or left to lapse).
    if (record.claim.signature) return refuse("INTENT_SENT", MESSAGES.sent);
    return { ...changeOf(record), claim: null };
  });
}

/** Clock skew allowed between the server that made the intent and the chain's block time. */
const SKEW_MS = 60_000;

/**
 * Whether a landed transaction did what this intent asks of this wallet: it came after the intent was made, it spent at
 * least the intent's amount of what leaves, and what arrives grew. Only a swap in phase 1; a transfer by its amount.
 */
export function movesFit(record: IntentRecord, wallet: string, read: Extract<ChainRead, { state: "LANDED" }>): boolean {
  if (read.blockTime !== null && read.blockTime * 1000 < Date.parse(record.body.createdAt) - SKEW_MS) return false;
  if (read.failed) return true;
  const spec = record.body.spec;
  const { lamports, tokens } = read.moves;
  const spentSol = lamports.pre - lamports.post - lamports.fee;
  const tokenDelta = (mint: string) => {
    const row = tokens.get(mint);
    return row ? row.post - row.pre : 0n;
  };
  const amount = BigInt(spec.amountRaw);
  if (spec.action === "transfer") return spec.coin === "SOL" ? spentSol >= amount : -tokenDelta(spec.coin) >= amount;
  // SOL is traded wrapped and unwrapped within the transaction: its legs show in the wallet's lamports.
  const { inputMint, outputMint } = swapLeg(spec);
  const spent = inputMint === PAY_MINTS.SOL ? spentSol : -tokenDelta(inputMint);
  const gained = outputMint === PAY_MINTS.SOL ? lamports.post - lamports.pre + lamports.fee : tokenDelta(outputMint);
  return spent >= amount && gained > 0n;
}

/**
 * The claiming wallet's signature ends the intent for good. Where the chain can be read, the transaction must have
 * landed with that wallet paying for it; a signature no node has seen yet is refused for now and may be sent again.
 */
export function receiptIntent(deps: IntentDeps, id: string, input: ReceiptInput): Promise<IntentAnswer> {
  if (!SIGNATURE.test(input.signature)) return Promise.resolve(refuse("VALIDATION_ERROR", "signature: the transaction's signature."));
  return step(deps, id, input, async (record, status, now) => {
    if (status === "DONE") {
      const same = record.receipt?.signature === input.signature && record.receipt.wallet === input.wallet;
      return same ? answer(record, now) : refuse("INTENT_USED", MESSAGES.used);
    }
    if (status === "CANCELLED") return refuse("INTENT_CANCELLED", MESSAGES.cancelled);
    // A marked claim is receipted by its own signature even after its lease ran out: the bytes left in time.
    const marked = record.claim?.signature ?? null;
    if (status === "EXPIRED" || status === "OPEN" || !record.claim) return refuse("INTENT_NOT_CLAIMED", "Confirm the intent before sending its receipt.");
    if (record.claim.wallet !== input.wallet) return refuse("INTENT_BUSY", MESSAGES.busy);
    if (marked !== input.signature) return refuse("INTENT_RECEIPT_MISMATCH", "This is not the signature that was marked before sending.");
    let chain: ReceiptChain = "UNCHECKED";
    if (deps.chain) {
      const read = await deps.chain(input.signature);
      if (read.state === "UNREADABLE") return refuse("UNAVAILABLE", "The chain could not be read. Send the receipt again.");
      if (read.state === "UNSEEN") return refuse("INTENT_RECEIPT_UNSEEN", "The transaction is not on chain yet. Send the receipt again.");
      if (read.feePayer !== input.wallet) return refuse("INTENT_RECEIPT_MISMATCH", "This transaction was not paid by the confirming wallet.");
      if (!movesFit(record, input.wallet, read)) return refuse("INTENT_RECEIPT_MISMATCH", "This transaction did not do what the intent asks.");
      chain = read.failed ? "FAILED" : "CONFIRMED";
    }
    return { ...changeOf(record), receipt: { wallet: input.wallet, signature: input.signature, at: deps.now().toISOString(), chain } };
  });
}

/**
 * Its creator withdraws the intent while nobody holds it: the link then says so and never opens a sheet again. A claim
 * in progress is not interrupted — the person may already be signing.
 */
export function cancelIntent(deps: IntentDeps, id: string, key: string | null): Promise<IntentAnswer> {
  return change(
    deps,
    id,
    (record) => (keyMatches(record, key) ? null : refuse("INTENT_KEY_INVALID", MESSAGES.key)),
    async (record, status, now) => {
      if (status === "CANCELLED" || status === "EXPIRED") return answer(record, now);
      if (status === "DONE" || status === "LAPSED") return refuse("INTENT_USED", MESSAGES.used);
      if (status === "CLAIMED") return refuse("INTENT_BUSY", MESSAGES.busy);
      return { ...changeOf(record), cancelledAt: now.toISOString() };
    },
  );
}
