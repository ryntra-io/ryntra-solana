import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import type { RyntraServiceFee } from "../swap/service-fee.ts";
import { SOLANA_ACTION_LANES, SOLANA_ACTION_OUTCOMES, type SolanaActionLane, type SolanaActionOutcome } from "./action-lanes.ts";
import { SolanaActionOriginSchema, type SolanaActionOrigin } from "./action-origin.ts";

/**
 * The wallet's own history — what this person did, keyed by the wallet that
 * did it.
 *
 * ## Why a fourth collection rather than a query over the three that exist
 *
 * Send, Swap and Bridge each already keep durable state, and each is keyed by
 * whatever makes its own boundary decidable: `solanaSendAttempts` by the exact
 * signature, because that is what proves these bytes were broadcast once;
 * `solanaSwapOwnerLocks` by the owner slot, because one wallet may have one
 * open swap; `solanaCctpBurns` by the burn intent, because a rebuilt burn is
 * different bytes and the same money leaving twice. Those keys are correct and
 * this module does not touch them.
 *
 * They simply cannot answer the question a person asks. `valuesWithPrefix` is
 * the only scan the store port has, so a list-by-wallet needs the wallet to be
 * the *leading* key segment — and it leads in none of them. Worse, two of the
 * three do not hold the address at all: a Send row is hashes, a signature,
 * state and timestamps by deliberate design, and a Bridge claim hashes the
 * owner into its key one-way and keeps no owner field. Neither can be
 * re-indexed by wallet from the store; only by re-reading each signature back
 * off the chain.
 *
 * So this is an **index, never a boundary**. Nothing here decides whether money
 * may move. If a write to this collection fails, the transfer is unaffected and
 * the person's history is briefly incomplete — which is the correct direction
 * for a history to fail in, and why every writer here is non-fatal.
 *
 * ## Four words, not three state machines
 *
 * The lanes speak twenty-eight states between them: `SUBMITTED_UNKNOWN`,
 * `EXPIRED_AFTER_SUBMIT`, `ATTESTED`, `MINT_OBSERVED`, `RECOVERY_REQUIRED`.
 * Every one of them is meaningful to the code and none of them belongs on a
 * screen a customer reads. They collapse here into the only four distinctions
 * that change what a person does next:
 *
 * - `IN_FLIGHT` — the money may already have moved and there is no final answer
 *   yet. The one state that must never be rendered as either success or
 *   failure.
 * - `DONE` — it happened, and the two sides agree.
 * - `FAILED` — it did not happen. Nothing left.
 * - `NEEDS_YOU` — it is waiting on a step only this person can take: the second
 *   leg of a bridge, or a recovery.
 *
 * The mapping lives beside each lane's own vocabulary below, so a lane that
 * gains a state fails the exhaustiveness check here rather than quietly
 * rendering as something wrong.
 *
 * ## Read by address, and where that stops
 *
 * The product splits public from private on proof of ownership, and
 * `/api/solana/holdings` is the precedent: a Solana address is public, anyone
 * can read it on an explorer, and gating a public read behind a signature is
 * theatre. Every field stored here is already visible under that same address
 * on chain — a signature, an amount, a mint, a moment. Reading it back needs
 * the address, which is the same key that already opens the chain.
 *
 * What is deliberately *not* stored here is everything that would not be
 * public: no note, no label, no counterparty name, nothing the person authored.
 * Those are private wallet-scoped data in exactly that sense and they wait on a
 * Solana sign-in that does not exist in this repository yet — the wallet route
 * is EVM SIWE only, and it refuses wallet-only accounts on purpose.
 */

/** The fee's settled vocabulary as a row carries it; `QUOTED` never reaches a row. */
export const ACTION_FEE_STATES = ["COLLECTED", "NOT_COLLECTED", "NOT_APPLIED", "UNCONFIGURED", "NONE"] as const;
export type ActionFeeState = (typeof ACTION_FEE_STATES)[number];

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX_DIGEST = /^0x[0-9a-f]{64}$/;
const RAW_AMOUNT = /^(0|[1-9][0-9]*)$/;

/* `RECEIVE` joined on 2026-09-07: a payment request observed as paid writes
   one row for the recipient wallet, keyed by the request's reference key. It
   is the only lane a wallet did not start itself, and it carries public chain
   facts only — signature, amount, mint. */
/* The list itself lives in `action-lanes.ts`, which imports nothing, so the
   browser can read the same one instead of a copy. Re-exported here because
   this module has always been where callers look for it. */
export {
  SOLANA_ACTION_LANES,
  SOLANA_ACTION_OUTCOMES,
  type SolanaActionLane,
  type SolanaActionOutcome,
} from "./action-lanes.ts";

/**
 * One leg of value, in raw base units.
 *
 * Raw strings end to end, exactly as every other Solana module in this product
 * carries an amount: a float cannot represent a token balance and a number that
 * has been through one is not the amount that moved.
 */
const MovementSchema = z
  .object({
    mint: z.string().regex(BASE58_ADDRESS).nullable(),
    amountRaw: z.string().regex(RAW_AMOUNT),
    /**
     * Nullable, because the product itself does not always know.
     *
     * The whole swap lane works in raw base units and leaves formatting to the
     * client's token catalogue — where `decimals` is `number | null` too. A
     * surface that cannot resolve them shows the asset and the state without a
     * number, rather than picking a scale and printing a wrong amount, which is
     * the same rule Holdings applies to an unknown price.
     */
    decimals: z.number().int().min(0).max(18).nullable(),
    symbol: z.string().min(1).max(24).nullable(),
  })
  .strict();

export type SolanaActionMovement = z.output<typeof MovementSchema>;

/**
 * What Ryntra charged on this operation, and whether it was actually taken.
 *
 * Until this field existed a row could say what moved and never what it cost,
 * so the two real fills of 2026-09-11 showed a person an amount sent, an amount
 * received, and no answer at all to *what did this cost me* — while the
 * provider was reporting a collected fee for both.
 *
 * `collected` is the whole reason this is an object rather than a number. A
 * quoted fee and a taken one are different facts — Relay documents an operation
 * shape that collects nothing and reports no error — and a surface that
 * displayed the quote would be telling somebody they paid something they did
 * not.
 */
const ActionFeeSchema = z
  .object({
    collected: z.boolean(),
    /** Measured from what was paid against what was sent, never assumed from the current rate. */
    basisPoints: z.number().int().min(0).max(10_000).nullable(),
    /** Raw base units of the asset the fee was taken in. Null where the provider states only a value. */
    amountRaw: z.string().regex(RAW_AMOUNT).nullable(),
    decimals: z.number().int().min(0).max(18).nullable(),
    symbol: z.string().min(1).max(24).nullable(),
    /** The provider's own dollar measurement of this fill, never a price read later. */
    usd: z.number().nullable(),
    /**
     * The fee asset itself — a mint on Solana, a contract elsewhere — and who
     * ended up with what, in raw units of it.
     *
     * A row that says what a person paid and not where it went cannot answer
     * the question *what did Ryntra make* without assuming the provider's cut
     * from a rate; the settlement already states the split, so it is written
     * down here beside the gross. All three default to null so every row
     * written before them still parses.
     */
    asset: z.string().min(1).max(64).nullable().default(null),
    providerRaw: z.string().regex(RAW_AMOUNT).nullable().default(null),
    ryntraRaw: z.string().regex(RAW_AMOUNT).nullable().default(null),
    /**
     * What the provider said about the fee, and why.
     *
     * `collected: false` alone cannot tell *the provider took nothing* from
     * *no fee was ever requested*: the two swaps of 2026-09-10 made while the
     * product's rate sat under Jupiter's floor left rows with no fee and no
     * reason, and the statistics could only say "no marker". The state is the
     * settled fee's own vocabulary and the note is the provider's stated
     * reason, so an operation without an on-chain marker names its cause.
     * Both default to null so every row written before them still parses.
     */
    state: z.enum(ACTION_FEE_STATES).nullable().default(null),
    note: z.string().max(400).nullable().default(null),
  })
  .strict();

export type SolanaActionFee = z.output<typeof ActionFeeSchema>;
/** What a writer supplies: the defaulted fields may be left out. */
export type SolanaActionFeeInput = z.input<typeof ActionFeeSchema>;

/**
 * The row's fee, read off a settled service fee.
 *
 * Only a fee the provider has reported on — taken, or explicitly not taken —
 * becomes a row fee. A quoted, unconfigured or unapplied one leaves the row's
 * fee untouched, because a row that says nothing is honest and a row that says
 * `collected: false` reads like a measured nothing. The rate is the one the
 * provider confirmed rather than one measured against the amount sent: Jupiter
 * takes its fee in whichever mint it prefers, which is often not the input.
 */
export function actionFeeFromServiceFee(fee: RyntraServiceFee | null | undefined): SolanaActionFeeInput | undefined {
  if (!fee) return undefined;
  /* A fee the provider never carried — not applied, or never configured — is
     written down as exactly that, with the provider's reason, so the row can
     say why this operation has no marker rather than saying nothing. A
     quoted fee still says nothing: the operation has not settled. */
  if (fee.state === "NOT_APPLIED" || fee.state === "UNCONFIGURED") {
    return {
      collected: false,
      basisPoints: null,
      amountRaw: null,
      decimals: null,
      symbol: null,
      usd: null,
      asset: fee.asset ?? null,
      providerRaw: null,
      ryntraRaw: null,
      state: fee.state,
      note: fee.note ? fee.note.slice(0, 400) : null,
    };
  }
  if (fee.state !== "COLLECTED" && fee.state !== "NOT_COLLECTED") return undefined;
  const settlement = fee.settlement;
  return {
    collected: fee.state === "COLLECTED",
    basisPoints: fee.basisPoints,
    amountRaw: settlement?.userPaidRaw ?? fee.amountRaw,
    decimals: settlement?.decimals ?? fee.decimals,
    symbol: settlement?.symbol ?? fee.symbol,
    usd: fee.usd,
    asset: settlement?.asset ?? fee.asset,
    providerRaw: settlement?.providerRaw ?? null,
    ryntraRaw: settlement?.ryntraRaw ?? null,
    state: fee.state,
    note: fee.note ? fee.note.slice(0, 400) : null,
  };
}

export const SolanaWalletActionSchema = z
  .object({
    schema: z.literal("ryntra.solana.wallet-action"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(0),
    network: z.enum(["mainnet", "devnet"]),
    wallet: z.string().regex(BASE58_ADDRESS),
    /** Signature for Send and Swap, burn intent digest for Bridge. */
    actionId: z.string().min(8).max(128),
    lane: z.enum(SOLANA_ACTION_LANES),
    outcome: z.enum(SOLANA_ACTION_OUTCOMES),
    /** What left the wallet. Null where the lane has not resolved it. */
    out: MovementSchema.nullable(),
    /** What arrived. Null for a Send, and for anything not yet settled. */
    in: MovementSchema.nullable(),
    /** Where a bridge sends value, as a plain place rather than a domain id. */
    destination: z.enum(["BASE", "SOLANA", "ETHEREUM", "ROBINHOOD"]).nullable(),
    signature: z.string().regex(SIGNATURE).nullable(),
    receiptHash: z.string().regex(HEX_DIGEST).nullable(),
    /**
     * The transactions on their own chains, for a lane whose money does not
     * move on Solana alone.
     *
     * `signature` above is base58 by schema, which is right — a Base hash in it
     * would fail the row and cost the whole write. But that left a cross-chain
     * row with no way to be looked at anywhere: both fills of 2026-09-11 were
     * real transactions on two public chains and Activity offered no link to
     * either. These two carry them in the shape each chain actually uses.
     */
    sourceTx: z.string().min(3).max(128).nullable().default(null),
    destinationTx: z.string().min(3).max(128).nullable().default(null),
    /** Null on every row written before fees were recorded, and on every unpriced lane. */
    fee: ActionFeeSchema.nullable().default(null),
    /**
     * Where the action was started from — `SPOT` with a side, or null for a
     * Swap and for every row written before Spot existed. Same lane, same
     * engine, same money; a different thing the person did.
     */
    origin: SolanaActionOriginSchema.nullable().default(null),
    /**
     * The provider's own id for this operation — Jupiter's `requestId` for the
     * swap lane — so a row can be matched to the provider's record without
     * opening the owner lock it came from. Null on every row written before it.
     */
    providerRef: z.string().min(1).max(128).nullable().default(null),
    /**
     * The provider's own dollar figure for this exact fill, when the input
     * that moved is the input that was quoted — the same rule Points uses
     * (`statedUsd`). Never a price read later: a row without one stays
     * unvalued where no stablecoin leg gives par. Null before this field.
     */
    statedUsd: z.number().nonnegative().nullable().default(null),
    startedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SolanaWalletAction = z.output<typeof SolanaWalletActionSchema>;

const COLLECTION = "solanaWalletActions" as const;

/**
 * The wallet leads, because `valuesWithPrefix` is the only scan there is.
 *
 * The trailing colon in {@link solanaWalletActionPrefix} is not cosmetic: base58
 * addresses have no fixed length, so scanning `…:<wallet>` without it would
 * also return the rows of any wallet whose address begins with this one.
 */
export function solanaWalletActionKey(
  args: Readonly<{ network: string; wallet: string; actionId: string }>,
): string {
  return `solana:${args.network}:${args.wallet}:${args.actionId}`;
}

export function solanaWalletActionPrefix(args: Readonly<{ network: string; wallet: string }>): string {
  return `solana:${args.network}:${args.wallet}:`;
}

/* ------------------------------------------------------------------ mapping */

/**
 * Send's durable and derived states, collapsed.
 *
 * `SUBMITTED_UNKNOWN` and `RECOVERY_REQUIRED` are the two that matter most.
 * Both mean the bytes may be live and nobody has read the answer back yet, so
 * both are `IN_FLIGHT` rather than a failure — the whole point of the submit
 * boundary is that an unknown is not a licence to send again.
 */
export function sendOutcome(state: string): SolanaActionOutcome {
  switch (state) {
    case "RECEIPTED":
    case "FINALIZED":
    case "CONFIRMED":
      return "DONE";
    case "LANDED_FAILED":
    case "EXPIRED_BEFORE_SUBMIT":
    case "EXPIRED_AFTER_SUBMIT":
      return "FAILED";
    case "RECOVERY_REQUIRED":
      return "NEEDS_YOU";
    default:
      return "IN_FLIGHT";
  }
}

export function swapOutcome(state: string): SolanaActionOutcome {
  switch (state) {
    case "RECEIPTED":
      return "DONE";
    case "FAILED":
    case "EXPIRED_BEFORE_SUBMIT":
    case "EXPIRED_AFTER_SUBMIT":
      /* `EXPIRED_AFTER_SUBMIT` is written only after a recovery read the whole
         ledger, found no trace of the signature and saw the block that could
         have carried it pass — the bytes went out and did nothing, and can
         never do anything now. That is an answer, not a question: it rendered
         as *Needs you* with a button that repeated the same answer (a swap on
         2026-09-11), so History said a person owed an
         action when nothing was owed. The Swap card already calls this
         *nothing happened*; History now agrees with it — *Did not happen*. */
      return "FAILED";
    default:
      return "IN_FLIGHT";
  }
}

/**
 * Bridge, where `NEEDS_YOU` earns its place.
 *
 * `ATTESTED` means Circle has signed and the money is claimable on Base by a
 * second signature this person has not given yet. Rendering that as "in
 * flight" would tell somebody to wait for something that is waiting for them.
 */
export function bridgeOutcome(state: string): SolanaActionOutcome {
  switch (state) {
    case "RECEIPTED":
      return "DONE";
    case "EXPIRED_BEFORE_BURN":
    case "BURN_REVERTED":
      return "FAILED";
    case "ATTESTED":
    case "MINT_OBSERVED":
    case "RECOVERY_REQUIRED":
      return "NEEDS_YOU";
    default:
      return "IN_FLIGHT";
  }
}

/** The outcomes in which value may have left and not yet arrived. */
export function solanaActionInMotion(action: SolanaWalletAction): boolean {
  return action.outcome === "IN_FLIGHT" || action.outcome === "NEEDS_YOU";
}

/* ------------------------------------------------------------------- writes */

export type RecordSolanaActionInput = Readonly<{
  network: "mainnet" | "devnet";
  wallet: string;
  actionId: string;
  lane: SolanaActionLane;
  outcome: SolanaActionOutcome;
  out?: SolanaActionMovement | null;
  in?: SolanaActionMovement | null;
  destination?: "BASE" | "SOLANA" | "ETHEREUM" | "ROBINHOOD" | null;
  signature?: string | null;
  receiptHash?: string | null;
  sourceTx?: string | null;
  destinationTx?: string | null;
  fee?: SolanaActionFeeInput | null;
  origin?: SolanaActionOrigin | null;
  providerRef?: string | null;
  statedUsd?: number | null;
  now: string;
}>;

export type RecordSolanaActionResult =
  | Readonly<{ ok: true; action: SolanaWalletAction }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * Write or advance one row. Never throws to its caller.
 *
 * A history that can fail a transfer is worse than a history with a hole in it.
 * Every caller of this is a money path that has already done the thing being
 * recorded, so the contract is a result object and a swallowed fault, not an
 * exception — and the returned `reason` is for a log, never for a screen.
 */
export async function recordSolanaAction(
  store: GuardStore,
  input: RecordSolanaActionInput,
): Promise<RecordSolanaActionResult> {
  const key = solanaWalletActionKey(input);
  const collection = store.versioned<SolanaWalletAction>(COLLECTION);

  try {
    return await withBoundedCasRetry(async () => {
      const existing = await readOne(store, key);
      const base: z.input<typeof SolanaWalletActionSchema> = {
        schema: "ryntra.solana.wallet-action",
        schemaVersion: "1.0.0",
        version: existing ? existing.version + 1 : 1,
        network: input.network,
        wallet: input.wallet,
        actionId: input.actionId,
        lane: input.lane,
        outcome: input.outcome,
        /* An update that does not carry a leg keeps the one already recorded.
           A settle response that names only what arrived must not erase what
           left. */
        out: input.out !== undefined ? input.out : (existing?.out ?? null),
        in: input.in !== undefined ? input.in : (existing?.in ?? null),
        destination: input.destination !== undefined ? input.destination : (existing?.destination ?? null),
        signature: input.signature !== undefined ? input.signature : (existing?.signature ?? null),
        receiptHash: input.receiptHash !== undefined ? input.receiptHash : (existing?.receiptHash ?? null),
        sourceTx: input.sourceTx !== undefined ? input.sourceTx : (existing?.sourceTx ?? null),
        destinationTx: input.destinationTx !== undefined ? input.destinationTx : (existing?.destinationTx ?? null),
        fee: input.fee !== undefined ? input.fee : (existing?.fee ?? null),
        origin: input.origin !== undefined ? input.origin : (existing?.origin ?? null),
        providerRef: input.providerRef !== undefined ? input.providerRef : (existing?.providerRef ?? null),
        statedUsd: input.statedUsd !== undefined ? input.statedUsd : (existing?.statedUsd ?? null),
        startedAt: existing?.startedAt ?? input.now,
        updatedAt: input.now,
      };
      const parsed = SolanaWalletActionSchema.safeParse(base);
      if (!parsed.success) return { ok: false as const, reason: "SOLANA_ACTION_MALFORMED" };
      const wrote = await collection.compareAndSet(key, existing ? existing.version : null, parsed.data);
      if (!wrote) return false;
      return { ok: true as const, action: parsed.data };
    });
  } catch (failure) {
    return { ok: false, reason: failure instanceof Error ? failure.message : "SOLANA_ACTION_UNAVAILABLE" };
  }
}

async function readOne(store: GuardStore, key: string): Promise<SolanaWalletAction | null> {
  const raw = await store.collection<unknown>(COLLECTION).get(key);
  if (raw === undefined || raw === null) return null;
  const parsed = SolanaWalletActionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/* -------------------------------------------------------------------- reads */

export type ListSolanaActionsResult = Readonly<{
  actions: readonly SolanaWalletAction[];
  /**
   * Whether every row this wallet has was readable.
   *
   * A malformed row is dropped rather than guessed at, and the caller is told
   * so it can say the list may be incomplete. Where coverage is partial it is
   * marked honestly, never filled in.
   */
  complete: boolean;
}>;

/**
 * Every action this wallet took on this network, newest first.
 *
 * Sorted on `updatedAt` rather than `startedAt`: a bridge started on Monday and
 * claimable today is the row a person is looking for, and burying it under
 * three transfers made since would be sorting by the wrong question.
 */
export async function listSolanaWalletActions(
  store: GuardStore,
  args: Readonly<{ network: string; wallet: string }>,
): Promise<ListSolanaActionsResult> {
  const rows = await store.collection<unknown>(COLLECTION).valuesWithPrefix(solanaWalletActionPrefix(args));
  const actions: SolanaWalletAction[] = [];
  let complete = true;
  for (const row of rows) {
    const parsed = SolanaWalletActionSchema.safeParse(row);
    if (!parsed.success) {
      complete = false;
      continue;
    }
    actions.push(parsed.data);
  }
  actions.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0));
  return { actions, complete };
}

/**
 * Cross-chain swap: one asset in on one network, another out on another,
 * through Mayan. The order record's own vocabulary lives in
 * `lib/mayan/cross-swap-order.ts`; History needs only the four words.
 *
 * `IN_PROGRESS` and `SUBMITTED` are money in motion. `REFUNDED` is `NEEDS_YOU`
 * rather than `FAILED` because the person has something to look at: the refund
 * may have arrived as a different token than the one they sent.
 */
export function crossSwapOutcome(state: string): SolanaActionOutcome {
  switch (state) {
    case "COMPLETED":
      return "DONE";
    case "SOURCE_FAILED":
    case "EXPIRED_BEFORE_SUBMIT":
      return "FAILED";
    case "REFUNDED":
    case "RECOVERY_REQUIRED":
      return "NEEDS_YOU";
    default:
      return "IN_FLIGHT";
  }
}
