/**
 * The credits ledger (AI-04) — durable, in the Guard store, one holder at a
 * time: a wallet (`wallet:<address>`) or, once the wallet is linked, its
 * account (`account:<uuid>`), into which the wallet's credits merge.
 *
 * - **One balance record per holder**, advanced by compare-and-set: the free
 *   credits of the UTC day, the welcome credits (`bonus`), the bought ones
 *   (`paid`), the reservations still open, the day's spend against its cap and
 *   the per-scope limits (a paid watch, AI-05).
 * - **Entries only append.** Every change writes one entry per effect, keyed
 *   by the holder's sequence, in the same atomic write as the balance — so the
 *   entries replay to the balance and none is ever rewritten.
 * - **Idempotency keys.** An operation names its key; the key's record is
 *   written in that same atomic write, so a repeat returns the first answer
 *   and never takes, gives or charges twice.
 * - **Reserve → capture → release.** The price is held before the call; the
 *   actual is captured after it and the difference goes back; a call that
 *   never reached the provider releases all of it. A hold nobody settled (a
 *   crashed instance) is given back when it expires. Free credits go first,
 *   then the welcome ones, then the bought ones; given back the other way.
 * - **Never below zero**, never past the day's cap or a scope's limit, and
 *   nothing of the balance is spent without the price the person was shown.
 *
 * Nothing here moves money, signs or reads a key: credits are the service's
 * own units (`prices.ts`).
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { withBoundedCasRetry, type GuardAtomicVersionedWrite, type GuardStore } from "../../guard/store.ts";
import { CREDIT_ACTIONS, type CreditAction, type CreditsConfig } from "./prices.ts";

export const CREDITS_COLLECTION = "assistantCredits" as const;

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const HOLDER = /^(?:wallet:[1-9A-HJ-NP-Za-km-z]{32,44}|account:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const IDEM = /^[A-Za-z0-9:_.-]{1,120}$/;

export const walletHolder = (wallet: string): string => {
  if (!BASE58_ADDRESS.test(wallet)) throw new TypeError("Not a Solana address.");
  return `wallet:${wallet}`;
};
export const accountHolder = (accountId: string): string => {
  const id = accountId.toLowerCase();
  if (!UUID.test(id)) throw new TypeError("Not an account id.");
  return `account:${id}`;
};

/** Open reservations per holder; one more is refused rather than queued. */
export const HOLDS_MAX = 16;
/** Per-scope limits kept on the balance (a paid watch each, AI-05). */
export const SCOPES_MAX = 64;
const AMOUNT_MAX = 1_000_000_000;
/** Compare-and-set rounds before an honest «try again»: a holder's own calls rarely race, a burst of them may. */
const CAS_ROUNDS = 12;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Iso = z.string().datetime({ offset: true });
const Count = z.number().int().min(0).max(AMOUNT_MAX);
const Parts = z.object({ free: Count, bonus: Count, paid: Count }).strict();
const Delta = z.object({ free: z.number().int(), bonus: z.number().int(), paid: z.number().int() }).strict();
const Scope = z.string().regex(/^[a-z][a-z0-9:_-]{1,63}$/);

const HoldSchema = z
  .object({
    id: z.string().regex(/^crh_[0-9a-f]{16}$/),
    action: z.enum(CREDIT_ACTIONS),
    scope: Scope.nullable(),
    amount: Count,
    parts: Parts,
    /** The UTC day the free part was taken from: given back only on that same day. */
    freeDay: Day,
    at: Iso,
    expiresAt: Iso,
  })
  .strict();
export type CreditHold = z.output<typeof HoldSchema>;

const ScopeUseSchema = z.object({ scope: Scope, day: Day, dayUsed: Count, total: Count }).strict();

const BalanceSchema = z
  .object({
    schema: z.literal("ryntra.assistant-credits"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(1),
    holder: z.string().regex(HOLDER),
    paid: Count,
    bonus: Count,
    free: z.object({ day: Day, used: Count }).strict(),
    /** Credits of the balance (bonus and paid) held or spent this UTC day, against the day's cap. */
    spent: z.object({ day: Day, credits: Count }).strict(),
    spentTotal: Count,
    holds: z.array(HoldSchema).max(HOLDS_MAX),
    scopes: z.array(ScopeUseSchema).max(SCOPES_MAX),
    welcome: z.boolean(),
    /** Set on a wallet whose credits moved into its account; the account is where they are now. */
    mergedInto: z.string().regex(HOLDER).nullable(),
    seq: z.number().int().min(0),
    updatedAt: Iso,
  })
  .strict();
export type CreditBalance = z.output<typeof BalanceSchema>;

export const ENTRY_KINDS = ["grant", "hold", "capture", "release", "expire", "merge-out", "merge-in"] as const;
export type CreditEntryKind = (typeof ENTRY_KINDS)[number];

const EntrySchema = z
  .object({
    schema: z.literal("ryntra.assistant-credit-entry"),
    schemaVersion: z.literal("1.0.0"),
    version: z.literal(1),
    holder: z.string().regex(HOLDER),
    seq: z.number().int().min(1),
    kind: z.enum(ENTRY_KINDS),
    action: z.enum(CREDIT_ACTIONS).nullable(),
    /** Why a grant was made: `welcome`, `purchase` (AI-12), `adjust` (the operator's correction). */
    reason: z.enum(["welcome", "purchase", "adjust"]).nullable(),
    holdId: z.string().regex(/^crh_[0-9a-f]{16}$/).nullable(),
    /** The other holder of a merge. */
    counterpart: z.string().regex(HOLDER).nullable(),
    /** What this entry did to the person's credits: negative is taken, positive given back or granted. */
    delta: Delta,
    /** The UTC day of the free part of `delta`. */
    freeDay: Day,
    /** For a capture: the credits charged in the end. */
    charged: Count.nullable(),
    idem: z.string().regex(IDEM),
    at: Iso,
  })
  .strict();
export type CreditEntry = z.output<typeof EntrySchema>;

const IdemSchema = z.object({ version: z.literal(1), holder: z.string().regex(HOLDER), op: z.string().min(1).max(32), result: z.unknown(), at: Iso }).strict();

const dayOf = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);
export const nextDayIso = (nowMs: number): string => {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
};

const balanceKey = (holder: string): string => `bal:${holder}`;
const entryKey = (holder: string, seq: number): string => `entry:${holder}:${String(seq).padStart(10, "0")}`;
const idemKey = (holder: string, key: string): string => `idem:${holder}:${key}`;
/** A claim no second grant may make — the welcome per wallet and per account. Written once, never removed. */
export const claimKey = (claim: string): string => `claim:${claim}`;

type Record_ = { version: number };

function emptyBalance(holder: string, nowMs: number): CreditBalance {
  const day = dayOf(nowMs);
  return { schema: "ryntra.assistant-credits", schemaVersion: "1.0.0", version: 0, holder, paid: 0, bonus: 0, free: { day, used: 0 }, spent: { day, credits: 0 }, spentTotal: 0, holds: [], scopes: [], welcome: false, mergedInto: null, seq: 0, updatedAt: new Date(nowMs).toISOString() };
}

const collection = (store: GuardStore) => store.versioned<Record_>(CREDITS_COLLECTION);

export async function readBalance(store: GuardStore, holder: string): Promise<CreditBalance | null> {
  const raw = await collection(store).get(balanceKey(holder));
  if (raw === undefined) return null;
  const parsed = BalanceSchema.safeParse(raw);
  /* A record that does not parse is not a zero balance: it is refused loudly rather than overwritten. */
  if (!parsed.success) throw new Error("The credits record does not parse.");
  return parsed.data;
}

async function readIdem(store: GuardStore, holder: string, key: string): Promise<unknown | undefined> {
  const raw = await collection(store).get(idemKey(holder, key));
  if (raw === undefined) return undefined;
  const parsed = IdemSchema.safeParse(raw);
  return parsed.success ? parsed.data.result : undefined;
}

/* ------------------------------------------------------------ the working copy */

/** A balance being changed in one operation, with the entries it writes. */
class Draft {
  readonly entries: CreditEntry[] = [];
  next: CreditBalance;
  readonly current: CreditBalance;
  readonly expected: number | null;
  readonly nowMs: number;
  constructor(current: CreditBalance, expected: number | null, nowMs: number) {
    this.current = current;
    this.expected = expected;
    this.nowMs = nowMs;
    const today = dayOf(nowMs);
    /*
     * A new UTC day: the free credits and the day's spend start again. Never
     * a day back: an operation carrying an earlier clock (a question asked
     * before midnight and settled after it, another instance's clock) keeps
     * the newer day's counts — it must not reset them.
     */
    const roll = current.free.day < today;
    this.next = {
      ...current,
      free: roll ? { day: today, used: 0 } : current.free,
      spent: current.spent.day < today ? { day: today, credits: 0 } : current.spent,
      scopes: current.scopes.map((use) => (use.day < today ? { ...use, day: today, dayUsed: 0 } : use)),
    };
  }
  /** The UTC day the balance's day counts belong to — today, or a later day another clock already opened. */
  get bucketDay(): string {
    return this.next.free.day;
  }
  get today(): string {
    return dayOf(this.nowMs);
  }
  entry(input: Omit<CreditEntry, "schema" | "schemaVersion" | "version" | "holder" | "seq" | "at">): void {
    const seq = this.next.seq + 1;
    this.next = { ...this.next, seq };
    this.entries.push(EntrySchema.parse({ schema: "ryntra.assistant-credit-entry", schemaVersion: "1.0.0", version: 1, holder: this.current.holder, seq, at: new Date(this.nowMs).toISOString(), ...input }));
  }
  /** Give back a hold's parts, less what was charged: the bought first, then the welcome, then the free — and the day's counts only into the day they were taken from. */
  giveBack(hold: CreditHold, charged: number): Readonly<{ free: number; bonus: number; paid: number }> {
    let keep = charged;
    const keepFrom = (part: number) => {
      const kept = Math.min(part, keep);
      keep -= kept;
      return part - kept;
    };
    /* What was charged is kept from the free part first — the person's own credits come back before the day's free ones. */
    const free = keepFrom(hold.parts.free);
    const bonus = keepFrom(hold.parts.bonus);
    const paid = keepFrom(hold.parts.paid);
    const sameDay = hold.freeDay === this.next.free.day;
    const freeBack = sameDay ? free : 0;
    const balanceBack = bonus + paid;
    this.next = {
      ...this.next,
      paid: this.next.paid + paid,
      bonus: this.next.bonus + bonus,
      free: { ...this.next.free, used: Math.max(0, this.next.free.used - freeBack) },
      spent: hold.freeDay === this.next.spent.day ? { ...this.next.spent, credits: Math.max(0, this.next.spent.credits - balanceBack) } : this.next.spent,
      spentTotal: this.next.spentTotal + (hold.parts.bonus - bonus) + (hold.parts.paid - paid),
      holds: this.next.holds.filter((entry) => entry.id !== hold.id),
      scopes: hold.scope === null ? this.next.scopes : this.next.scopes.map((use) => (use.scope === hold.scope ? { ...use, dayUsed: use.day === hold.freeDay ? Math.max(0, use.dayUsed - (hold.amount - charged)) : use.dayUsed, total: Math.max(0, use.total - (hold.amount - charged)) } : use)),
    };
    return { free: freeBack, bonus, paid };
  }
  /** Holds nobody settled in time go back whole. */
  expireStale(): void {
    for (const hold of this.next.holds) {
      if (Date.parse(hold.expiresAt) > this.nowMs) continue;
      const back = this.giveBack(hold, 0);
      this.entry({ kind: "expire", action: hold.action, reason: null, holdId: hold.id, counterpart: null, delta: back, freeDay: hold.freeDay, charged: 0, idem: `expire:${hold.id}` });
    }
  }
  writes(extra: readonly GuardAtomicVersionedWrite[] = []): GuardAtomicVersionedWrite[] {
    const balance = BalanceSchema.parse({ ...this.next, version: this.current.version + 1, updatedAt: new Date(this.nowMs).toISOString() });
    return [
      { collection: CREDITS_COLLECTION, key: balanceKey(this.current.holder), expectedVersion: this.expected, next: balance },
      ...this.entries.map((entry) => ({ collection: CREDITS_COLLECTION, key: entryKey(entry.holder, entry.seq), expectedVersion: null, next: entry })),
      ...extra,
    ];
  }
}

async function draftFor(store: GuardStore, holder: string, nowMs: number): Promise<Draft> {
  const current = await readBalance(store, holder);
  return new Draft(current ?? emptyBalance(holder, nowMs), current ? current.version : null, nowMs);
}

const idemWrite = (holder: string, key: string, op: string, result: unknown, nowMs: number): GuardAtomicVersionedWrite => ({
  collection: CREDITS_COLLECTION,
  key: idemKey(holder, key),
  expectedVersion: null,
  next: IdemSchema.parse({ version: 1, holder, op, result, at: new Date(nowMs).toISOString() }),
});

type Refusal<C extends string> = Readonly<{ ok: false; code: C; reason: string }>;

/**
 * One operation: read, decide, write atomically with its idempotency record;
 * a lost race re-reads, a repeat returns the first answer. A decision that
 * refuses writes nothing — not even the key, so the same key may try again.
 */
async function operate<R extends Readonly<{ ok: boolean }>>(store: GuardStore, holder: string, key: string, op: string, decide: (draft: Draft) => Readonly<{ result: R; extra?: readonly GuardAtomicVersionedWrite[] }>, nowMs: number): Promise<R | Refusal<"UNAVAILABLE">> {
  if (!HOLDER.test(holder)) return { ok: false, code: "UNAVAILABLE", reason: "Not a credits holder." };
  if (!IDEM.test(key)) return { ok: false, code: "UNAVAILABLE", reason: "Not an idempotency key." };
  try {
    return await withBoundedCasRetry(async () => {
      const seen = await readIdem(store, holder, key);
      if (seen !== undefined) return { ...(seen as R), repeat: true };
      const draft = await draftFor(store, holder, nowMs);
      const decided = decide(draft);
      if (!decided.result.ok) return decided.result;
      const written = await store.compareAndSetMany(draft.writes([...(decided.extra ?? []), idemWrite(holder, key, op, decided.result, nowMs)]));
      return written ? decided.result : false;
    }, CAS_ROUNDS);
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "The credits store did not answer; nothing was taken." };
  }
}

/* ------------------------------------------------------------ grant */

export type GrantResult = Readonly<{ ok: true; credits: number; repeat?: boolean }> | Refusal<"CLAIM_TAKEN" | "UNAVAILABLE">;

/**
 * Credit a holder: the welcome credits (`bonus`) or bought ones (`paid`,
 * AI-12). `claims` are keys no second grant may make (the welcome per wallet
 * and per account): written in the same atomic write, so two grants at once
 * make one.
 */
export async function grantCredits(store: GuardStore, holder: string, input: Readonly<{ credits: number; bucket: "bonus" | "paid"; reason: "welcome" | "purchase" | "adjust"; idem: string; claims?: readonly string[]; nowMs: number }>): Promise<GrantResult> {
  if (!Number.isSafeInteger(input.credits) || input.credits < 1 || input.credits > AMOUNT_MAX) return { ok: false, code: "UNAVAILABLE", reason: "Not a number of credits." };
  const claims = input.claims ?? [];
  const result = await operate<Readonly<{ ok: true; credits: number }> | Refusal<"CLAIM_TAKEN">>(
    store,
    holder,
    input.idem,
    "grant",
    (draft) => {
      if (input.reason === "welcome" && draft.next.welcome) return { result: { ok: false, code: "CLAIM_TAKEN", reason: "The welcome credits were already given." } };
      draft.next = { ...draft.next, [input.bucket]: draft.next[input.bucket] + input.credits, welcome: draft.next.welcome || input.reason === "welcome" };
      draft.entry({ kind: "grant", action: null, reason: input.reason, holdId: null, counterpart: null, delta: { free: 0, bonus: input.bucket === "bonus" ? input.credits : 0, paid: input.bucket === "paid" ? input.credits : 0 }, freeDay: draft.today, charged: null, idem: input.idem });
      return { result: { ok: true, credits: input.credits }, extra: claims.map((claim) => ({ collection: CREDITS_COLLECTION, key: claimKey(claim), expectedVersion: null, next: { version: 1, holder, at: new Date(input.nowMs).toISOString() } })) };
    },
    input.nowMs,
  );
  if (!result.ok && result.code === "UNAVAILABLE" && claims.length > 0) {
    /* A claim that exists makes every write fail: say so, rather than «try again». */
    for (const claim of claims) if ((await collection(store).get(claimKey(claim)).catch(() => undefined)) !== undefined) return { ok: false, code: "CLAIM_TAKEN", reason: "The welcome credits were already given." };
  }
  return result;
}

/**
 * AI-12: bought credits granted in the same atomic write as the order's own
 * records — its compare-and-set and the claims of the payments it counts. One
 * attempt: a lost race writes nothing and says `lost`, and the caller reads
 * its order again; `repeat` — this key was written, so the order has moved on.
 */
export async function grantWithOrder(store: GuardStore, holder: string, input: Readonly<{ credits: number; idem: string; extra: readonly GuardAtomicVersionedWrite[]; nowMs: number }>): Promise<"written" | "lost" | "repeat"> {
  if (!HOLDER.test(holder) || !IDEM.test(input.idem)) throw new TypeError("Not a credits holder or key.");
  if (!Number.isSafeInteger(input.credits) || input.credits < 1 || input.credits > AMOUNT_MAX) throw new TypeError("Not a number of credits.");
  if ((await readIdem(store, holder, input.idem)) !== undefined) return "repeat";
  const draft = await draftFor(store, holder, input.nowMs);
  draft.next = { ...draft.next, paid: draft.next.paid + input.credits };
  draft.entry({ kind: "grant", action: null, reason: "purchase", holdId: null, counterpart: null, delta: { free: 0, bonus: 0, paid: input.credits }, freeDay: draft.today, charged: null, idem: input.idem });
  const written = await store.compareAndSetMany(draft.writes([...input.extra, idemWrite(holder, input.idem, "grant", { ok: true, credits: input.credits }, input.nowMs)]));
  return written ? "written" : "lost";
}

export async function claimTaken(store: GuardStore, claim: string): Promise<boolean> {
  return (await collection(store).get(claimKey(claim))) !== undefined;
}

/* ------------------------------------------------------------ reserve, capture, release */

export type ReserveInput = Readonly<{
  action: CreditAction;
  /** The price of the action now, in credits. */
  amount: number;
  /** What the person was shown before the action; `null` when the client showed none — then only free credits may go. */
  acceptCredits: number | null;
  idem: string;
  /** A paid watch's own limits (AI-05): credits per UTC day and in all, beside the holder's day cap. */
  scope?: Readonly<{ id: string; daily: number; total: number }>;
  config: CreditsConfig;
  nowMs: number;
}>;

export type ReserveRefusal = "CREDITS_EXHAUSTED" | "CREDITS_LIMIT" | "PRICE_NOT_SHOWN" | "CREDITS_BUSY" | "UNAVAILABLE";
export type ReserveResult = Readonly<{ ok: true; holdId: string; amount: number; parts: Readonly<{ free: number; bonus: number; paid: number }>; repeat?: boolean }> | Refusal<ReserveRefusal>;

export function newHoldId(): string {
  return `crh_${randomBytes(8).toString("hex")}`;
}

export async function reserveCredits(store: GuardStore, holder: string, input: ReserveInput): Promise<ReserveResult> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > AMOUNT_MAX) return { ok: false, code: "UNAVAILABLE", reason: "Not a price." };
  const holdId = newHoldId();
  return operate<ReserveResult>(
    store,
    holder,
    input.idem,
    "reserve",
    (draft) => {
      draft.expireStale();
      const balance = draft.next;
      if (balance.holds.length >= HOLDS_MAX) return { result: { ok: false, code: "CREDITS_BUSY", reason: "Too many actions are being answered at once; try again in a moment." } };
      const freeLeft = Math.max(0, input.config.freeDaily - balance.free.used);
      const free = Math.min(freeLeft, input.amount);
      const rest = input.amount - free;
      /* Nothing of the balance without the price shown: the person saw it, or the free credits pay it all. */
      if (rest > 0 && (input.acceptCredits === null || input.acceptCredits < input.amount)) return { result: { ok: false, code: "PRICE_NOT_SHOWN", reason: input.acceptCredits === null ? "Today's free credits are spent, and no price was shown for this action." : `The price is now ${input.amount} credits — more than the ${input.acceptCredits} shown.` } };
      const bonus = Math.min(balance.bonus, rest);
      const paid = rest - bonus;
      if (paid > balance.paid) return { result: { ok: false, code: "CREDITS_EXHAUSTED", reason: `This needs ${input.amount} credits; today's free ones and the balance hold fewer.` } };
      if (balance.spent.credits + rest > input.config.dailySpendCap) return { result: { ok: false, code: "CREDITS_LIMIT", reason: `The day's limit of ${input.config.dailySpendCap} credits is reached; it starts again tomorrow (UTC).` } };
      let scopes = balance.scopes;
      if (input.scope) {
        const scope = input.scope;
        const use = scopes.find((entry) => entry.scope === scope.id) ?? { scope: scope.id, day: draft.bucketDay, dayUsed: 0, total: 0 };
        if (use.dayUsed + input.amount > scope.daily || use.total + input.amount > scope.total) return { result: { ok: false, code: "CREDITS_LIMIT", reason: "This watch's own limit is reached." } };
        if (!scopes.some((entry) => entry.scope === scope.id) && scopes.length >= SCOPES_MAX) return { result: { ok: false, code: "CREDITS_LIMIT", reason: "Too many paid watches." } };
        scopes = [...scopes.filter((entry) => entry.scope !== scope.id), { ...use, dayUsed: use.dayUsed + input.amount, total: use.total + input.amount }];
      }
      const at = new Date(input.nowMs).toISOString();
      const hold: CreditHold = { id: holdId, action: input.action, scope: input.scope?.id ?? null, amount: input.amount, parts: { free, bonus, paid }, freeDay: draft.bucketDay, at, expiresAt: new Date(input.nowMs + input.config.holdMs).toISOString() };
      draft.next = { ...balance, paid: balance.paid - paid, bonus: balance.bonus - bonus, free: { ...balance.free, used: balance.free.used + free }, spent: { ...balance.spent, credits: balance.spent.credits + rest }, holds: [...balance.holds, hold], scopes };
      draft.entry({ kind: "hold", action: input.action, reason: null, holdId, counterpart: null, delta: { free: -free, bonus: -bonus, paid: -paid }, freeDay: draft.bucketDay, charged: null, idem: input.idem });
      return { result: { ok: true, holdId, amount: input.amount, parts: { free, bonus, paid } } };
    },
    input.nowMs,
  );
}

export type SettleResult = Readonly<{ ok: true; charged: number; returned: number; repeat?: boolean }> | Refusal<"HOLD_NOT_FOUND" | "UNAVAILABLE">;

/**
 * Settle a hold: `charged` of it kept (at most the hold), the rest given
 * back. `charged: 0` is a release. A hold that already expired was given
 * back whole and is not found — the person is never charged twice for it.
 */
export async function settleCredits(store: GuardStore, holder: string, input: Readonly<{ holdId: string; charged: number; idem: string; nowMs: number }>): Promise<SettleResult> {
  if (!Number.isSafeInteger(input.charged) || input.charged < 0) return { ok: false, code: "UNAVAILABLE", reason: "Not a number of credits." };
  return operate<SettleResult>(
    store,
    holder,
    input.idem,
    "settle",
    (draft) => {
      const hold = draft.next.holds.find((entry) => entry.id === input.holdId);
      if (!hold) return { result: { ok: false, code: "HOLD_NOT_FOUND", reason: "No open reservation has that id." } };
      const charged = Math.min(hold.amount, input.charged);
      const back = draft.giveBack(hold, charged);
      draft.entry({ kind: charged === 0 ? "release" : "capture", action: hold.action, reason: null, holdId: hold.id, counterpart: null, delta: back, freeDay: hold.freeDay, charged, idem: input.idem });
      draft.expireStale();
      return { result: { ok: true, charged, returned: hold.amount - charged } };
    },
    input.nowMs,
  );
}

/* ------------------------------------------------------------ merge */

export type MergeResult = Readonly<{ ok: true; moved: Readonly<{ bonus: number; paid: number }>; repeat?: boolean }> | Refusal<"CREDITS_BUSY" | "UNAVAILABLE">;

/**
 * A wallet linked to an account: its credits move into the account — the
 * welcome flag with them, and the day's free credits counted as the larger of
 * the two, so linking never makes a second free day. Refused while the
 * wallet has an open reservation; the next call tries again.
 */
export async function mergeHolders(store: GuardStore, from: string, into: string, nowMs: number): Promise<MergeResult> {
  if (!HOLDER.test(from) || !HOLDER.test(into) || from === into || !from.startsWith("wallet:") || !into.startsWith("account:")) return { ok: false, code: "UNAVAILABLE", reason: "Not a wallet and an account." };
  const key = `merge:${into}:${nowMs}`;
  try {
    return await withBoundedCasRetry(async () => {
      const source = await draftFor(store, from, nowMs);
      const target = await draftFor(store, into, nowMs);
      source.expireStale();
      if (source.next.holds.length > 0) return { ok: false, code: "CREDITS_BUSY", reason: "An action of this wallet is being answered." } as const;
      /* Moved already and nothing new since: a second merge at once (two first requests after the link) writes nothing. */
      if (source.next.mergedInto === into && source.next.bonus === 0 && source.next.paid === 0) return { ok: true, moved: { bonus: 0, paid: 0 } } as const;
      /* One welcome per account: a wallet welcomed on its own, linked to an account already welcomed, brings its bought credits — not a second welcome. */
      const secondWelcome = source.next.welcome && target.next.welcome && source.next.bonus > 0;
      const moved = { bonus: secondWelcome ? 0 : source.next.bonus, paid: source.next.paid };
      const freeUsed = source.next.free.day === target.next.free.day ? Math.max(source.next.free.used, target.next.free.used) : target.next.free.used;
      const spent = source.next.spent.day === target.next.spent.day ? target.next.spent.credits + source.next.spent.credits : target.next.spent.credits;
      const takenOut = { bonus: source.next.bonus, paid: source.next.paid };
      /* The day's spend moves once: zeroed on the wallet, so a later merge never counts it again. */
      source.next = { ...source.next, bonus: 0, paid: 0, mergedInto: into, spent: { ...source.next.spent, credits: 0 } };
      /* What moves, and — apart, with its own reason — a second welcome written off, so the history never says it moved. */
      source.entry({ kind: "merge-out", action: null, reason: null, holdId: null, counterpart: into, delta: { free: 0, bonus: -moved.bonus, paid: -takenOut.paid }, freeDay: source.today, charged: null, idem: key });
      if (secondWelcome) source.entry({ kind: "merge-out", action: null, reason: "welcome", holdId: null, counterpart: into, delta: { free: 0, bonus: -takenOut.bonus, paid: 0 }, freeDay: source.today, charged: null, idem: `${key}:welcome` });
      target.next = { ...target.next, bonus: target.next.bonus + moved.bonus, paid: target.next.paid + moved.paid, welcome: target.next.welcome || source.next.welcome, free: { ...target.next.free, used: freeUsed }, spent: { ...target.next.spent, credits: spent } };
      target.entry({ kind: "merge-in", action: null, reason: null, holdId: null, counterpart: from, delta: { free: 0, bonus: moved.bonus, paid: moved.paid }, freeDay: target.today, charged: null, idem: key });
      const written = await store.compareAndSetMany([...source.writes(), ...target.writes()]);
      return written ? ({ ok: true, moved } as const) : false;
    }, CAS_ROUNDS);
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "The credits store did not answer; nothing moved." };
  }
}

/* ------------------------------------------------------------ reading */

export type CreditsView = Readonly<{
  holder: string;
  bonus: number;
  paid: number;
  free: Readonly<{ used: number; left: number; daily: number; resetsAt: string }>;
  reserved: number;
  dailySpend: Readonly<{ used: number; cap: number; resetsAt: string }>;
  welcome: boolean;
}>;

export async function readCredits(store: GuardStore, holder: string, config: CreditsConfig, nowMs: number): Promise<CreditsView> {
  const draft = new Draft((await readBalance(store, holder)) ?? emptyBalance(holder, nowMs), null, nowMs);
  /* What a read shows is what the next action would see: an expired hold is already back. */
  draft.expireStale();
  const balance = draft.next;
  return {
    holder,
    bonus: balance.bonus,
    paid: balance.paid,
    free: { used: Math.min(balance.free.used, config.freeDaily), left: Math.max(0, config.freeDaily - balance.free.used), daily: config.freeDaily, resetsAt: nextDayIso(nowMs) },
    reserved: balance.holds.reduce((sum, hold) => sum + hold.amount, 0),
    dailySpend: { used: balance.spent.credits, cap: config.dailySpendCap, resetsAt: nextDayIso(nowMs) },
    welcome: balance.welcome,
  };
}

/** The holder's entries, newest first — what the person reads as «Історія кредитів»: read by their sequence, never the whole history. */
export async function readEntries(store: GuardStore, holder: string, limit = 20): Promise<CreditEntry[]> {
  const balance = await readBalance(store, holder);
  if (!balance) return [];
  const out: CreditEntry[] = [];
  for (let seq = balance.seq; seq >= 1 && out.length < Math.max(0, limit); seq -= 1) {
    const parsed = EntrySchema.safeParse(await collection(store).get(entryKey(holder, seq)));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
