/**
 * Builds what a wallet signs for a cross-chain swap — server only.
 *
 * Imports Mayan's official SDK, which carries ethers v6, web3.js v1 and a Sui
 * client; nothing here may reach a client bundle (the `.server` suffix and the
 * route-only imports are the guard). Two builders, one per origin:
 *
 * - `buildSolanaSwiftTransaction` assembles a Swift order transaction whose
 *   only signer is the person's wallet. The SDK returns `signers: []` for
 *   Swift; a route that would need a generated keypair is refused here rather
 *   than signed by this process — nothing here holds or creates a Solana key.
 * - `buildEvmFastMctpCalls` encodes the Forwarder call (and, for an ERC-20
 *   input, the exact-amount approval before it) for an EIP-1193 wallet. Pure
 *   ABI encoding plus read-only RPC for allowance and gas; no signer.
 *
 * ## The half of the referrer fee that lives here
 *
 * A Mayan quote's `referrerBps` sets the rate, and `referrerAddresses` at
 * **build** time decides where — and whether — the fee is actually collected.
 * Both builders passed `null` for it, so a fee could have been quoted, shown to
 * a person and then collected by nobody. They now pass the configured address.
 *
 * One Solana address covers both of this product's routes — and it does so for
 * **two different reasons**, which is why `referrer.ts` records the reasons
 * rather than the conclusion. Swift pays on the source chain and this lane's
 * Swift source is Solana; Fast MCTP pays on the destination chain and this
 * lane's Fast MCTP destination is Solana. Neither fact says anything about a
 * third method, and an address configured against the wrong chain is quoted,
 * shown and collected by nobody. `mayanReferrerRoute` answers per quote.
 */

import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { addresses as MAYAN_ADDRESSES, createSwapFromSolanaInstructions, getSwapFromEvmTxPayload, type Quote } from "@mayanfinance/swap-sdk";

import { encodeErc20Approve, readBaseErc20Allowance } from "../base/cctp-burn.ts";
import { baseRpcCall, hexQuantityToDecimal, type EvmRpcHandle } from "../base/rpc.ts";
import type { MayanRawQuote } from "./price-api.ts";
import { mayanReferrerRoute, type MayanQuoteShape } from "./referrer.ts";

export const MAYAN_FORWARDER_CONTRACT: string = MAYAN_ADDRESSES.MAYAN_FORWARDER_CONTRACT;
export const MAYAN_SWIFT_V2_PROGRAM: string = MAYAN_ADDRESSES.SWIFT_V2_PROGRAM_ID;

/**
 * Whether a Solana referrer address can actually be paid on this quote.
 *
 * A thin wrapper over `mayanReferrerRoute`, which answers per method rather than
 * per product: Swift pays on the **source** chain and Fast MCTP on the
 * **destination**, so both land on Solana here for two different reasons and
 * neither reason generalises. See `referrer.ts`.
 */
export function mayanReferrerCollectable(quote: MayanQuoteShape): boolean {
  return mayanReferrerRoute(quote, { solana: "PLACEHOLDER11111111111111111111111111111111" }).collectable;
}

/** The one shape the SDK takes, from the one address this product configures. */
function referrerAddresses(referrer: string | null | undefined): Readonly<{ solana: string }> | null {
  return referrer ? { solana: referrer } : null;
}

export type SolanaSwiftBuild =
  | Readonly<{
      ok: true;
      unsignedWireBase64: string;
      blockhash: string;
      lastValidBlockHeight: number;
      feePayer: string;
      requiredSignatures: number;
      instructionCount: number;
      lookupTableCount: number;
      /** Program ids the message invokes, from its static keys, for the Pro disclosure and the trail. */
      programIds: readonly string[];
    }>
  | Readonly<{ ok: false; code: "ROUTE_NEEDS_PROVIDER_KEY" | "BUILD_FAILED" | "SIGNER_SHAPE"; reason: string }>;

export async function buildSolanaSwiftTransaction(args: {
  quote: MayanRawQuote;
  owner: string;
  destination: string;
  rpcUrl: string;
  /** Ryntra's Solana referrer address; omitted or null builds an order with no fee. */
  referrer?: string | null;
}): Promise<SolanaSwiftBuild> {
  if (args.quote.type !== "SWIFT") {
    return { ok: false, code: "ROUTE_NEEDS_PROVIDER_KEY", reason: `Only Swift is built from Solana; ${args.quote.type} needs a signer this process may not create.` };
  }
  const connection = new Connection(args.rpcUrl, "confirmed");
  let built: Awaited<ReturnType<typeof createSwapFromSolanaInstructions>>;
  try {
    built = await createSwapFromSolanaInstructions(args.quote as unknown as Quote, args.owner, args.destination, referrerAddresses(args.referrer), connection, {
      swiftRefundAddress: args.owner,
    });
  } catch (error) {
    return { ok: false, code: "BUILD_FAILED", reason: `Mayan's SDK could not build the order: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (built.signers.length > 0) {
    return {
      ok: false,
      code: "ROUTE_NEEDS_PROVIDER_KEY",
      reason: `This route needs ${built.signers.length} generated signer(s); only the wallet may sign here.`,
    };
  }
  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed"));
  } catch (error) {
    return { ok: false, code: "BUILD_FAILED", reason: `The cluster did not give a blockhash: ${error instanceof Error ? error.message : String(error)}` };
  }
  const message = new TransactionMessage({
    payerKey: new PublicKey(args.owner),
    recentBlockhash: blockhash,
    instructions: built.instructions,
  }).compileToV0Message(built.lookupTables);
  if (message.header.numRequiredSignatures !== 1) {
    return {
      ok: false,
      code: "SIGNER_SHAPE",
      reason: `The message asks for ${message.header.numRequiredSignatures} signatures; a wallet-only order asks for exactly one.`,
    };
  }
  const transaction = new VersionedTransaction(message);
  const programIds = [...new Set(message.compiledInstructions.map((ix) => message.staticAccountKeys[ix.programIdIndex]?.toBase58()).filter((id): id is string => Boolean(id)))];
  return {
    ok: true,
    unsignedWireBase64: Buffer.from(transaction.serialize()).toString("base64"),
    blockhash,
    lastValidBlockHeight,
    feePayer: args.owner,
    requiredSignatures: message.header.numRequiredSignatures,
    instructionCount: built.instructions.length,
    lookupTableCount: built.lookupTables.length,
    programIds,
  };
}

export type EvmCall = Readonly<{
  purpose: "APPROVE" | "SWAP";
  to: string;
  data: string;
  /** Hex wei; `0x0` for an approval. */
  value: string;
  gasEstimate: string | null;
  maximumCostWei: string | null;
  unpricedReason: string | null;
}>;

export type EvmFastMctpBuild =
  | Readonly<{
      ok: true;
      chainId: number;
      calls: readonly EvmCall[];
      walletPrompts: number;
      allowance: Readonly<{ token: string; spender: string; currentRaw: string; requiredRaw: string; sufficient: boolean }> | null;
      gasPriceWei: string | null;
      totalMaximumCostWei: string | null;
    }>
  | Readonly<{ ok: false; code: "BUILD_FAILED" | "ALLOWANCE_UNREADABLE" | "ROUTE_SHAPE"; reason: string }>;

function toHexQuantity(value: unknown): string {
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (typeof value === "number") return `0x${BigInt(value).toString(16)}`;
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]+$/.test(value)) return value.toLowerCase();
    if (/^[0-9]+$/.test(value)) return `0x${BigInt(value).toString(16)}`;
  }
  return "0x0";
}

export async function buildEvmFastMctpCalls(args: {
  quote: MayanRawQuote;
  owner: string;
  destination: string;
  chainId: number;
  handle: EvmRpcHandle;
  /** Null for the native coin; the ERC-20 contract otherwise. */
  inputToken: string | null;
  /** Ryntra's Solana referrer address; omitted or null encodes a call with no fee. */
  referrer?: string | null;
}): Promise<EvmFastMctpBuild> {
  if (args.quote.type !== "FAST_MCTP") {
    return { ok: false, code: "ROUTE_SHAPE", reason: `Only Fast MCTP is built from an EVM chain; ${args.quote.type} was offered.` };
  }
  let payload: Awaited<ReturnType<typeof getSwapFromEvmTxPayload>>;
  try {
    payload = await getSwapFromEvmTxPayload(
      args.quote as unknown as Quote,
      args.owner,
      args.destination,
      referrerAddresses(args.referrer),
      args.owner,
      args.chainId,
      null,
      null,
    );
  } catch (error) {
    return { ok: false, code: "BUILD_FAILED", reason: `Mayan's SDK could not encode the call: ${error instanceof Error ? error.message : String(error)}` };
  }
  const to = String(payload.to ?? "");
  const data = String(payload.data ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(to) || !/^0x[0-9a-fA-F]*$/.test(data) || data.length < 10) {
    return { ok: false, code: "BUILD_FAILED", reason: "Mayan's SDK returned a call without a target or calldata." };
  }
  if (to.toLowerCase() !== MAYAN_FORWARDER_CONTRACT.toLowerCase()) {
    return { ok: false, code: "ROUTE_SHAPE", reason: "The encoded call does not target Mayan's Forwarder; nothing else is signed from here." };
  }
  const value = toHexQuantity(payload.value ?? 0n);

  const gasPrice = await baseRpcCall<string>(args.handle, "eth_gasPrice", []);
  const gasPriceWei = gasPrice.ok ? hexQuantityToDecimal(gasPrice.value) : null;
  const priced = async (purpose: EvmCall["purpose"], callTo: string, callData: string, callValue: string): Promise<EvmCall> => {
    const estimate = await baseRpcCall<string>(args.handle, "eth_estimateGas", [{ from: args.owner, to: callTo, data: callData, value: callValue }]);
    const gasEstimate = estimate.ok ? hexQuantityToDecimal(estimate.value) : null;
    return {
      purpose,
      to: callTo,
      data: callData,
      value: callValue,
      gasEstimate,
      maximumCostWei: gasEstimate !== null && gasPriceWei !== null ? (BigInt(gasEstimate) * BigInt(gasPriceWei)).toString() : null,
      unpricedReason: gasEstimate !== null ? null : estimate.ok ? "The node returned a gas estimate that is not a quantity." : estimate.reason,
    };
  };

  const calls: EvmCall[] = [];
  let allowance: Extract<EvmFastMctpBuild, { ok: true }>["allowance"] = null;
  if (args.inputToken) {
    const required = args.quote.effectiveAmountIn64;
    const read = await readBaseErc20Allowance(args.handle, { token: args.inputToken, owner: args.owner, spender: MAYAN_FORWARDER_CONTRACT });
    if (!read.ok) return { ok: false, code: "ALLOWANCE_UNREADABLE", reason: read.reason };
    const sufficient = BigInt(read.raw) >= BigInt(required);
    allowance = { token: args.inputToken, spender: MAYAN_FORWARDER_CONTRACT, currentRaw: read.raw, requiredRaw: required, sufficient };
    if (!sufficient) {
      /* Exact amount, never unlimited: the approval is part of this one swap. */
      calls.push(await priced("APPROVE", args.inputToken, encodeErc20Approve(MAYAN_FORWARDER_CONTRACT, required), "0x0"));
    }
  }
  /* The swap call is estimated only when no approval is pending: estimating a
     forward the token has not yet approved reverts, and a revert is not a price. */
  const swap =
    calls.length === 0
      ? await priced("SWAP", to, data, value)
      : { purpose: "SWAP" as const, to, data, value, gasEstimate: null, maximumCostWei: null, unpricedReason: "Priced after the approval lands." };
  calls.push(swap);
  const total = calls.every((call) => call.maximumCostWei !== null) ? calls.reduce((sum, call) => sum + BigInt(call.maximumCostWei as string), 0n).toString() : null;
  return { ok: true, chainId: args.chainId, calls, walletPrompts: calls.length, allowance, gasPriceWei, totalMaximumCostWei: total };
}
