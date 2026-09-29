/**
 * Independent chain read of a landed swap (RYN-SOL-M2).
 *
 * The transfer observer reads generic balance movement; a swap needs the
 * taker's OWN two legs, which requires owner-aware token deltas the transfer
 * schema deliberately drops. This module reads the transaction once from the
 * given (independent) RPC handle and derives, for the taker only: the actual
 * input and output raw amounts, the base/priority fee split, and the invoked
 * top-level programs. Provider prose is never consulted — everything here
 * comes from the transaction's own pre/post balances.
 *
 * `RYN-SOL-SWAP-MONETIZATION-001` adds one more read off the same metadata: the
 * Ryntra service fee Jupiter actually collected. It needs no new request and no
 * arithmetic. A V2 referral token account is a **plain associated token account
 * whose authority is the referral account** — verified on chain 2026-09-10, with
 * the `["referral_ata", referral, mint]` PDA the older API implies absent for the
 * same pair — so the fee is an ordinary owner-scoped token movement and the
 * existing `tokenDeltaFor` reads it exactly. Jupiter states the fee's rate in the
 * order and never its amount, so this is the only place the amount is known, and
 * a delta of zero means the fee was not taken rather than that it was small.
 */

import { describeChainError } from "./chain-error.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";
import { WRAPPED_SOL_MINT } from "./send-kinds.ts";

const LAMPORTS_PER_SIGNATURE = 5_000n;

type TokenBalanceEntry = Readonly<{
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: Readonly<{ amount?: string }>;
}>;

export type SwapObservationFailure = Readonly<{
  ok: false;
  code: "RPC_FAILED" | "NOT_FOUND" | "UNREADABLE" | "LANDED_FAILED" | "LEG_UNRESOLVED";
  reason: string;
  /** Present on LANDED_FAILED: the chain's own error, stringified. */
  chainError: string | null;
}>;

export type SwapObservationSuccess = Readonly<{
  ok: true;
  observation: Readonly<{
    signature: string;
    slot: string;
    finality: "confirmed" | "finalized";
    actualInputRaw: string;
    actualOutputRaw: string;
    baseFeeLamports: string;
    priorityFeeLamports: string;
    programs: readonly string[];
    observedAt: string;
    source: Readonly<{ ref: string; label: string }>;
    /**
     * Raw base units of the fee mint that reached Ryntra's referral account in
     * this transaction.
     *
     * Inside the observation rather than beside it, because it is a fact this
     * transaction states about itself and the Receipt seals it with the rest.
     * `null` when no referral account was given to look for; `"0"` is a real
     * answer and a different one — the fee was asked for and nothing arrived.
     */
    serviceFeeCollectedRaw: string | null;
  }>;
  feeLamports: string;
  takerLamportDelta: string;
}>;

export type SwapObservationResult = SwapObservationSuccess | SwapObservationFailure;

function tokenDeltaFor(args: {
  pre: readonly TokenBalanceEntry[];
  post: readonly TokenBalanceEntry[];
  owner: string;
  mint: string;
}): bigint {
  const amounts = new Map<number, { pre: bigint; post: bigint }>();
  for (const entry of args.pre) {
    if (entry.owner !== args.owner || entry.mint !== args.mint) continue;
    const raw = entry.uiTokenAmount?.amount;
    if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) continue;
    amounts.set(entry.accountIndex, { pre: BigInt(raw), post: 0n });
  }
  for (const entry of args.post) {
    if (entry.owner !== args.owner || entry.mint !== args.mint) continue;
    const raw = entry.uiTokenAmount?.amount;
    if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) continue;
    const existing = amounts.get(entry.accountIndex);
    if (existing) existing.post = BigInt(raw);
    else amounts.set(entry.accountIndex, { pre: 0n, post: BigInt(raw) });
  }
  let delta = 0n;
  for (const { pre, post } of amounts.values()) delta += post - pre;
  return delta;
}

/**
 * What to look for, taken from the quote the person actually reviewed.
 *
 * Not from configuration. If the referral account were re-read here and it had
 * changed since the Review, this would measure the balance of an account the
 * signed transaction never touched and report it as Ryntra's income. The
 * reviewed quote is the only thing that knows which account the bytes were built
 * against.
 */
export function serviceFeeReadFor(
  quote: Readonly<{
    providerReferralAccount: string | null;
    ryntraFee: Readonly<{ state: string; asset: string | null }>;
  }>,
): Readonly<{ referralAccount: string; feeMint: string }> | null {
  if (quote.ryntraFee.state !== "QUOTED") return null;
  if (!quote.providerReferralAccount || !quote.ryntraFee.asset) return null;
  return { referralAccount: quote.providerReferralAccount, feeMint: quote.ryntraFee.asset };
}

export async function observeSwap(
  handle: SolanaRpcHandle,
  args: Readonly<{
    signature: string;
    taker: string;
    inputMint: string;
    outputMint: string;
    /** Required signatures on the exact message; splits base from priority fee. */
    requiredSignatures: number;
    finality: "confirmed" | "finalized";
    /**
     * Ryntra's referral account and the mint Jupiter said it would take the fee
     * in, so the amount actually collected can be read off this same
     * transaction. Omitted when no fee was requested.
     */
    serviceFee?: Readonly<{ referralAccount: string; feeMint: string }> | null;
    now?: Date;
  }>,
): Promise<SwapObservationResult> {
  let response: unknown;
  try {
    response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getTransaction(args.signature as never, {
          encoding: "json",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })
        .send({ abortSignal }),
    );
  } catch (failure) {
    return {
      ok: false,
      code: "RPC_FAILED",
      chainError: null,
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
  if (response === null || response === undefined) {
    return {
      ok: false,
      code: "NOT_FOUND",
      chainError: null,
      reason: `${handle.network} has no record of ${args.signature} at confirmed commitment.`,
    };
  }

  const observedAt = (args.now ?? new Date()).toISOString();
  try {
    const value = response as {
      slot: bigint | number;
      meta: {
        err: unknown;
        fee: bigint | number;
        preTokenBalances?: readonly TokenBalanceEntry[];
        postTokenBalances?: readonly TokenBalanceEntry[];
        preBalances?: readonly (bigint | number)[];
        postBalances?: readonly (bigint | number)[];
      } | null;
      transaction: {
        message: {
          accountKeys: readonly unknown[];
          instructions?: readonly Readonly<{ programIdIndex: number }>[];
        };
      };
    };
    if (!value.meta) {
      return {
        ok: false,
        code: "UNREADABLE",
        chainError: null,
        reason: `${args.signature} was returned without metadata; no balance movement can be read.`,
      };
    }
    if (value.meta.err !== null && value.meta.err !== undefined) {
      return {
        ok: false,
        code: "LANDED_FAILED",
        chainError: describeChainError(value.meta.err).slice(0, 512),
        reason: "The transaction landed and failed; the chain moved no swap value.",
      };
    }

    const staticKeys = value.transaction.message.accountKeys.map((key) =>
      typeof key === "string" ? key : String((key as { pubkey?: unknown }).pubkey ?? ""),
    );
    const takerIndex = staticKeys.indexOf(args.taker);
    if (takerIndex === -1) {
      return {
        ok: false,
        code: "UNREADABLE",
        chainError: null,
        reason: "The taker is not among the transaction's static account keys.",
      };
    }
    const pre = value.meta.preBalances?.[takerIndex];
    const post = value.meta.postBalances?.[takerIndex];
    if (pre === undefined || post === undefined) {
      return {
        ok: false,
        code: "UNREADABLE",
        chainError: null,
        reason: "The transaction metadata carries no lamport balances for the taker.",
      };
    }
    const fee = BigInt(value.meta.fee);
    const lamportDelta = BigInt(post) - BigInt(pre);

    const legRaw = (mint: string, direction: "input" | "output"): bigint | null => {
      const tokenDelta = tokenDeltaFor({
        pre: value.meta?.preTokenBalances ?? [],
        post: value.meta?.postTokenBalances ?? [],
        owner: args.taker,
        mint,
      });
      if (mint === WRAPPED_SOL_MINT && tokenDelta === 0n) {
        /* Jupiter wraps and unwraps around the route; the taker's SOL leg then
           lives in native lamports. The fee always leaves the taker, so it is
           added back to isolate the swap movement itself. */
        const movement = direction === "input" ? -(lamportDelta + fee) : lamportDelta + fee;
        return movement > 0n ? movement : null;
      }
      const movement = direction === "input" ? -tokenDelta : tokenDelta;
      return movement > 0n ? movement : null;
    };

    const actualInput = legRaw(args.inputMint, "input");
    const actualOutput = legRaw(args.outputMint, "output");
    if (actualInput === null || actualOutput === null) {
      return {
        ok: false,
        code: "LEG_UNRESOLVED",
        chainError: null,
        reason:
          "The taker's input or output movement could not be isolated from the transaction's balances. The receipt cannot state amounts it did not observe.",
      };
    }

    if (!Number.isSafeInteger(args.requiredSignatures) || args.requiredSignatures < 1 || args.requiredSignatures > 8) {
      return {
        ok: false,
        code: "UNREADABLE",
        chainError: null,
        reason: "The required signature count is outside its bound.",
      };
    }
    const baseFee = LAMPORTS_PER_SIGNATURE * BigInt(args.requiredSignatures);
    const priorityFee = fee > baseFee ? fee - baseFee : 0n;

    const programs = new Set<string>();
    for (const instruction of value.transaction.message.instructions ?? []) {
      const program = staticKeys[instruction.programIdIndex];
      if (program) programs.add(program);
    }
    if (programs.size === 0) {
      return {
        ok: false,
        code: "UNREADABLE",
        chainError: null,
        reason: "No top-level program could be read from the transaction message.",
      };
    }

    /* The fee Ryntra was actually paid, from the same metadata. Read against the
       referral account as the token owner rather than against a derived address,
       because that is what a V2 referral token account's authority is and it
       holds for SPL and Token-2022 alike. A negative delta would mean the
       account paid out during this transaction, which a swap fee never does; it
       is clamped to zero rather than recorded as negative revenue. */
    const serviceFee = args.serviceFee ?? null;
    const serviceFeeCollected = serviceFee
      ? tokenDeltaFor({
          pre: value.meta.preTokenBalances ?? [],
          post: value.meta.postTokenBalances ?? [],
          owner: serviceFee.referralAccount,
          mint: serviceFee.feeMint,
        })
      : null;

    const sourceRef = `solana:${handle.network}:rpc:getTransaction/${args.signature}`;
    return {
      ok: true,
      observation: {
        signature: args.signature,
        slot: String(value.slot),
        finality: args.finality,
        actualInputRaw: actualInput.toString(),
        actualOutputRaw: actualOutput.toString(),
        baseFeeLamports: baseFee.toString(),
        priorityFeeLamports: priorityFee.toString(),
        programs: [...programs].sort(),
        observedAt,
        source: {
          ref: sourceRef,
          label: `Solana ${handle.network} JSON-RPC (${handle.host()})`,
        },
        serviceFeeCollectedRaw:
          serviceFeeCollected === null ? null : (serviceFeeCollected > 0n ? serviceFeeCollected : 0n).toString(),
      },
      feeLamports: fee.toString(),
      takerLamportDelta: lamportDelta.toString(),
    };
  } catch (failure) {
    return {
      ok: false,
      code: "UNREADABLE",
      chainError: null,
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
}
