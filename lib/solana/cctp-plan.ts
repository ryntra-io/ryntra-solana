/**
 * The bridge burn, built.
 *
 * This is the CCTP counterpart of `transaction.ts`, and it is a separate module
 * rather than a branch inside that one because almost nothing is shared. A Send
 * plan is about a mint, a recipient token account and a transfer fee. A burn
 * plan is about a destination *domain*, a 32-byte recipient on another chain, a
 * fee Circle takes off the top, and an ephemeral account that must be created
 * and signed for. Folding them together would produce a type where half the
 * fields are null in either direction.
 *
 * ## Three signers, and only one of them is a wallet
 *
 * A live `depositForBurn` carries three signatures: the token owner, the fee
 * payer, and an ephemeral `MessageSent` account that receives rent and is
 * assigned to Circle's transmitter. On this lane the first two are the same
 * wallet, so the person sees one wallet prompt and one browser-local signature.
 *
 * The ephemeral keypair is generated in the browser and never reaches this
 * process. That is the invariant this module is written around: **nothing here
 * holds or creates a Solana key.** The server receives the ephemeral *public*
 * key, builds bytes that name it, and checks that no account exists at that
 * address yet — an address that is already an account cannot be created, and
 * discovering that after a wallet signature would waste a signature on a
 * transaction that cannot land.
 *
 * ## Why the fee is read rather than assumed
 *
 * `maxFee` is the ceiling Circle may take. Setting it too low reverts the burn
 * on the source chain — safe, but a wasted signature; setting it high hands
 * Circle a blank cheque. So the plan reads the live basis points for this exact
 * lane and sets `maxFee` to the fee those basis points produce, which on the
 * Standard tier of this route is exactly zero. A tier this module could not
 * read is not a zero fee, and the build refuses instead.
 */

import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
} from "@solana/kit";
import { createHash } from "node:crypto";

import {
  anyDestinationCaller,
  buildCctpBurnInstruction,
  cctpBurnIntentDigest,
  CCTP_FINALITY_THRESHOLD,
  deriveCctpBurnAccounts,
  evmMintRecipient,
} from "./cctp-burn.ts";
import type { CctpEvmChain, CctpSolanaSourceDirection } from "./cctp-direction.ts";
import type { CctpProviderSnapshot } from "./cctp-provider.ts";
import { SOLANA_CCTP_MAINNET_REGISTRY, solanaCctpLane } from "./cctp-registry.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";
import { associatedTokenAccount } from "./token-account.ts";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The `MessageSent` account's size in bytes.
 *
 * Derived from the reference mainnet burn rather than from a struct definition
 * this repository cannot cite: that burn paid 3,869,760 lamports of rent, and
 * Solana's rent-exempt minimum is `(128 + size) × 6960`, which gives 428. The
 * plan still asks the cluster for the current minimum at this size instead of
 * carrying the lamport figure, so a rent change moves the number rather than
 * making the plan wrong.
 */
export const CCTP_MESSAGE_SENT_ACCOUNT_BYTES = 428;

export type CctpPlanFailureCode =
  | "RECIPIENT_INVALID"
  | "OWNER_INVALID"
  | "EPHEMERAL_INVALID"
  | "EPHEMERAL_ACCOUNT_EXISTS"
  | "TOKEN_ACCOUNT_MISSING"
  | "BALANCE_INSUFFICIENT"
  | "LAMPORTS_INSUFFICIENT"
  | "PROVIDER_FACTS_UNAVAILABLE"
  | "AMOUNT_OUT_OF_RANGE"
  | "BLOCKHASH_UNAVAILABLE"
  | "FEE_UNAVAILABLE"
  | "RENT_UNAVAILABLE"
  | "BUILD_FAILED";

export type CctpPlanFailure = Readonly<{ ok: false; code: CctpPlanFailureCode; reason: string }>;

export type CctpBurnPlan = Readonly<{
  schema: "ryntra.solana.cctp-burn-plan";
  schemaVersion: "1.0.0";
  network: "mainnet";
  /** Which EVM chain the burn is bound for. Asked for by name, never assumed. */
  direction: CctpSolanaSourceDirection;
  /** Stated rather than implied by the module a reader happens to be in. */
  sourceChain: "solana";
  destinationChain: CctpEvmChain;
  /** Circle's numeric domains, restated so a reader never has to look them up. */
  sourceDomain: number;
  destinationDomain: number;
  owner: string;
  ownerTokenAccount: string;
  /** The EVM address that receives the mint, as the person typed it. */
  destinationRecipient: string;
  /** The same address as CCTP's 32-byte recipient: twelve zeroes, then twenty. */
  mintRecipientHex: string;
  /**
   * Thirty-two zero bytes: no address is pinned as the only one that may
   * complete the mint. This makes the destination step permissionless — anyone
   * holding the message and attestation may submit it. It does not make the
   * transfer unstoppable, and this product never says it does.
   */
  destinationCallerHex: string;
  amountRaw: string;
  /** The ceiling Circle may take, from the live basis points for this lane. */
  maxFeeRaw: string;
  protocolFeeRaw: string;
  expectedReceiveRaw: string;
  minFinalityThreshold: number;
  speed: "STANDARD" | "FAST";
  minimumFeeBps: string;
  /** The ephemeral account the browser generated. Its key never reaches here. */
  messageSentAccount: string;
  balances: Readonly<{
    usdcRaw: string;
    lamports: string;
    /** Lamports left after fee and rent, so the number is not a subtraction to do. */
    lamportsAfterBurn: string;
  }>;
  costs: Readonly<{
    baseFeeLamports: string;
    /** Rent for the ephemeral account. Reclaimable, and not before five days. */
    messageSentRentLamports: string;
    totalLamports: string;
    rentReclaimable: true;
    rentReclaimableAfterDays: 5;
  }>;
  programs: readonly string[];
  /** Every address the instruction names, in the order the program expects. */
  accounts: readonly string[];
  blockhash: string;
  lastValidBlockHeight: string;
  unsignedWireBase64: string;
  fingerprint: Readonly<{
    messageHash: string;
    feePayer: string;
    blockhash: string;
    instructionCount: number;
    /** Who must sign, in message order. Three, and the card says so beforehand. */
    signers: readonly string[];
  }>;
  /** What makes two burns the same burn. The duplicate-burn boundary's key. */
  intentDigest: string;
  builtAt: string;
}>;

export type CctpPlanResult = Readonly<{ ok: true; plan: CctpBurnPlan }> | CctpPlanFailure;

function decimalToScaled(value: string, decimals: number): bigint {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new Error("Fee basis points are malformed.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Fee basis points exceed the supported precision.");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

/** Circle rounds its fee up. So does this, because rounding down under-reserves. */
export function cctpProtocolFeeRaw(amountRaw: string, feeBps: string): string {
  const denominator = 10_000n * 1_000_000n;
  return ((BigInt(amountRaw) * decimalToScaled(feeBps, 6) + denominator - 1n) / denominator).toString();
}

function sha256Hex(bytes: Uint8Array): string {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Build the burn.
 *
 * Never throws: every refusal is a value with a code, because each one is an
 * ordinary outcome a person needs a sentence about — the wallet holds too
 * little, Circle's fee could not be read, the ephemeral address is already an
 * account.
 */
export async function buildCctpBurnPlan(args: {
  handle: SolanaRpcHandle;
  provider: CctpProviderSnapshot;
  owner: string;
  destinationRecipient: string;
  messageSentAccount: string;
  amountRaw: string;
  speed?: "STANDARD";
  /** Which EVM chain to burn towards. Base when unsaid, as every earlier caller meant. */
  direction?: CctpSolanaSourceDirection;
  now?: () => Date;
}): Promise<CctpPlanResult> {
  const builtAt = (args.now ?? (() => new Date()))().toISOString();
  const direction: CctpSolanaSourceDirection = args.direction ?? "SOLANA_TO_BASE";
  const lane = solanaCctpLane(direction);
  const destinationChain: CctpEvmChain = lane.destination.id === "ethereum" ? "ethereum" : "base";

  if (!SOLANA_ADDRESS.test(args.owner.trim())) {
    return { ok: false, code: "OWNER_INVALID", reason: "The owner wallet is not a Solana address." };
  }
  if (!EVM_ADDRESS.test(args.destinationRecipient.trim())) {
    return {
      ok: false,
      code: "RECIPIENT_INVALID",
      reason: `The ${lane.destination.label} recipient must be a 20-byte address. A Solana address on the ${lane.destination.label} side would burn into nothing.`,
    };
  }
  if (!SOLANA_ADDRESS.test(args.messageSentAccount.trim())) {
    return { ok: false, code: "EPHEMERAL_INVALID", reason: "The message account is not a Solana address." };
  }
  /**
   * The only amount this builder refuses is one that moves nothing.
   *
   * It used to refuse anything outside 2–5 USDC, which was canon §25.5's bound
   * on the *first owner canary* and never a fact about bridging. It made a
   * one-off experiment into the product's ceiling, so a person with 40 USDC to
   * move was told the transfer was out of range.
   *
   * Every real limit is below and is derived rather than written down: Circle's
   * live fee for this exact lane must be readable, the fee ceiling is computed
   * proportionally from the amount, the sender's USDC balance must cover it,
   * and the fee payer must hold enough lamports. Those refuse a transfer that
   * genuinely cannot happen. This one only refuses a transfer that would be
   * nothing at all.
   */
  const amount = BigInt(args.amountRaw);
  if (amount <= 0n) {
    return {
      ok: false,
      code: "AMOUNT_OUT_OF_RANGE",
      reason: "Enter an amount greater than zero.",
    };
  }

  /* Circle's live facts for this exact lane. A tier that could not be read is
     not a zero fee, and a plan that guessed one would set `maxFee` below what
     Circle takes and revert the burn after a signature was already spent. */
  if (args.provider.fees.state !== "AVAILABLE") {
    return {
      ok: false,
      code: "PROVIDER_FACTS_UNAVAILABLE",
      reason: "Circle's fee for this exact route could not be read, so no ceiling can be set for it.",
    };
  }
  const tier = args.provider.fees.tiers.find((entry) => entry.mode === "STANDARD");
  if (!tier) {
    return {
      ok: false,
      code: "PROVIDER_FACTS_UNAVAILABLE",
      reason: "Circle returned no Standard tier for this route.",
    };
  }
  const protocolFeeRaw = cctpProtocolFeeRaw(args.amountRaw, tier.minimumFeeBps);

  const usdcMint = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address;
  const ownerTokenAccount = await associatedTokenAccount({
    owner: args.owner,
    mint: usdcMint,
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  });

  let usdcRaw: string;
  let lamports: bigint;
  let ephemeralExists: boolean;
  try {
    const [tokenAccount, balance, ephemeral] = await Promise.all([
      withRpcDiscipline(args.handle, (abortSignal) =>
        args.handle.rpc.getTokenAccountBalance(ownerTokenAccount as never, { commitment: "confirmed" }).send({ abortSignal }),
      ),
      withRpcDiscipline(args.handle, (abortSignal) =>
        args.handle.rpc.getBalance(args.owner as never, { commitment: "confirmed" }).send({ abortSignal }),
      ),
      withRpcDiscipline(args.handle, (abortSignal) =>
        args.handle.rpc
          .getAccountInfo(args.messageSentAccount as never, { commitment: "confirmed", encoding: "base64" })
          .send({ abortSignal }),
      ),
    ]);
    usdcRaw = String(tokenAccount.value.amount);
    lamports = BigInt(balance.value);
    ephemeralExists = ephemeral.value !== null && ephemeral.value !== undefined;
  } catch (cause) {
    return {
      ok: false,
      code: "TOKEN_ACCOUNT_MISSING",
      reason: `The owner's USDC account or balance could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  if (ephemeralExists) {
    /* Caught here rather than after a signature: the program creates this
       account, and an address that is already one cannot be created. */
    return {
      ok: false,
      code: "EPHEMERAL_ACCOUNT_EXISTS",
      reason: "An account already exists at the message address, so this burn could not be created. Generate a fresh one.",
    };
  }
  if (BigInt(usdcRaw) < amount) {
    return {
      ok: false,
      code: "BALANCE_INSUFFICIENT",
      reason: "The wallet holds less USDC than this transfer would burn.",
    };
  }

  let blockhash: string;
  let lastValidBlockHeight: string;
  try {
    const latest = await withRpcDiscipline(args.handle, (abortSignal) =>
      args.handle.rpc.getLatestBlockhash({ commitment: "confirmed" }).send({ abortSignal }),
    );
    blockhash = String(latest.value.blockhash);
    lastValidBlockHeight = String(latest.value.lastValidBlockHeight);
  } catch (cause) {
    return {
      ok: false,
      code: "BLOCKHASH_UNAVAILABLE",
      reason: `The cluster did not return a blockhash: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const mintRecipient = evmMintRecipient(args.destinationRecipient);
  const destinationCaller = anyDestinationCaller();
  const intent = {
    owner: args.owner,
    rentPayer: args.owner,
    burnTokenAccount: ownerTokenAccount,
    messageSentAccount: args.messageSentAccount,
    amountRaw: args.amountRaw,
    destinationDomain: lane.destination.domain,
    mintRecipient,
    destinationCaller,
    maxFeeRaw: protocolFeeRaw,
    minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
  };

  let unsignedWireBase64: string;
  let messageBytes: Uint8Array;
  let accounts: readonly string[];
  try {
    const instruction = await buildCctpBurnInstruction(intent);
    accounts = (instruction.accounts ?? []).map((entry) => String(entry.address));
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayer(args.owner as Address, draft),
      (draft) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash as Blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
          draft,
        ),
      (draft) => appendTransactionMessageInstructions([instruction], draft),
    );
    const compiled = compileTransaction(message);
    unsignedWireBase64 = getBase64EncodedWireTransaction(compiled);
    messageBytes = compiled.messageBytes as unknown as Uint8Array;
  } catch (cause) {
    return {
      ok: false,
      code: "BUILD_FAILED",
      reason: `The burn instruction could not be built: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  let baseFeeLamports: string;
  try {
    const fee = await withRpcDiscipline(args.handle, (abortSignal) =>
      args.handle.rpc
        .getFeeForMessage(Buffer.from(messageBytes).toString("base64") as never, { commitment: "confirmed" })
        .send({ abortSignal }),
    );
    if (fee.value === null || fee.value === undefined) {
      return { ok: false, code: "FEE_UNAVAILABLE", reason: "The cluster returned no fee for these exact bytes." };
    }
    baseFeeLamports = String(fee.value);
  } catch (cause) {
    return {
      ok: false,
      code: "FEE_UNAVAILABLE",
      reason: `The endpoint did not price these exact bytes: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  let messageSentRentLamports: string;
  try {
    const rent = await withRpcDiscipline(args.handle, (abortSignal) =>
      args.handle.rpc.getMinimumBalanceForRentExemption(BigInt(CCTP_MESSAGE_SENT_ACCOUNT_BYTES)).send({ abortSignal }),
    );
    messageSentRentLamports = String(rent);
  } catch (cause) {
    return {
      ok: false,
      code: "RENT_UNAVAILABLE",
      reason: `The rent for the message account could not be read, and an unpriced rent is not a free one: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const totalLamports = BigInt(baseFeeLamports) + BigInt(messageSentRentLamports);
  if (lamports < totalLamports) {
    return {
      ok: false,
      code: "LAMPORTS_INSUFFICIENT",
      reason: "The wallet holds too little SOL for the network fee and the message account's rent.",
    };
  }

  const plan: CctpBurnPlan = {
    schema: "ryntra.solana.cctp-burn-plan",
    schemaVersion: "1.0.0",
    network: "mainnet",
    direction,
    sourceChain: "solana",
    destinationChain,
    sourceDomain: lane.source.domain,
    destinationDomain: lane.destination.domain,
    owner: args.owner,
    ownerTokenAccount,
    destinationRecipient: args.destinationRecipient.trim().toLowerCase(),
    mintRecipientHex: `0x${Buffer.from(mintRecipient).toString("hex")}`,
    destinationCallerHex: `0x${Buffer.from(destinationCaller).toString("hex")}`,
    amountRaw: args.amountRaw,
    maxFeeRaw: protocolFeeRaw,
    protocolFeeRaw,
    expectedReceiveRaw: (amount - BigInt(protocolFeeRaw)).toString(),
    minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
    speed: "STANDARD",
    minimumFeeBps: tier.minimumFeeBps,
    messageSentAccount: args.messageSentAccount,
    balances: {
      usdcRaw,
      lamports: lamports.toString(),
      lamportsAfterBurn: (lamports - totalLamports).toString(),
    },
    costs: {
      baseFeeLamports,
      messageSentRentLamports,
      totalLamports: totalLamports.toString(),
      rentReclaimable: true,
      rentReclaimableAfterDays: 5,
    },
    programs: [SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.components[1].address],
    accounts,
    blockhash,
    lastValidBlockHeight,
    unsignedWireBase64,
    fingerprint: {
      messageHash: sha256Hex(messageBytes),
      feePayer: args.owner,
      blockhash,
      instructionCount: 1,
      /* The owner appears once as fee payer and token authority. The message
         account is the second signature the card must explain in advance. */
      signers: [args.owner, args.messageSentAccount],
    },
    intentDigest: cctpBurnIntentDigest({
      direction,
      sourceDomain: lane.source.domain,
      owner: args.owner,
      burnTokenAccount: ownerTokenAccount,
      amountRaw: args.amountRaw,
      destinationDomain: lane.destination.domain,
      mintRecipient,
      minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
    }),
    builtAt,
  };
  return { ok: true, plan };
}

/** The derived accounts, for a surface that shows what the instruction names. */
export async function cctpPlanAccounts(plan: CctpBurnPlan) {
  return deriveCctpBurnAccounts({ owner: plan.owner, destinationDomain: plan.destinationDomain });
}
