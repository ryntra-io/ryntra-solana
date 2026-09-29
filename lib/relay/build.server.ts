/**
 * Builds what a wallet signs for a Robinhood Chain swap — server only.
 *
 * The counterpart of `lib/mayan/build.server.ts`, and much smaller, because
 * Relay's quote already contains the transaction. There is no provider SDK to
 * import and no second signer to refuse: the quote's `deposit` step *is* the
 * call, and this module's whole job is to check that it is the call it claims
 * to be before a person is shown a Review.
 *
 * ## The check that matters
 *
 * Mayan's builder refuses to sign anything that does not target Mayan's
 * Forwarder. The same rule here, and it is not a guess about which address is
 * right: Relay publishes the depository per chain in its own chain list
 * (`protocol.v2.depository`), and every quote read on 2026-09-09 targeted
 * exactly that address —
 * `0x4cd00e387622c35bddb9b4c962c136462338bc31` on chain 4663 and
 * `99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2` on Solana, across three
 * different amounts and both asset kinds. They are pinned here as constants
 * rather than read live, so a provider whose answer changes shape cannot move
 * the target of a signature by changing a field: the build fails, loudly, and
 * an operator looks at it.
 *
 * An ERC-20 origin also carries an `approve`, and that one must target the
 * token being spent with the depository as its spender — an approval pointed
 * anywhere else is the single most expensive thing a wallet can be asked to
 * sign, so it is checked with the same suspicion as the deposit.
 */

import { AddressLookupTableAccount, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { readBaseErc20Allowance } from "../base/cctp-burn.ts";
import { baseRpcCall, hexQuantityToDecimal, type EvmRpcHandle } from "../base/rpc.ts";
import type { EvmCall } from "../mayan/build.server.ts";
import { relayApprovalCount, relayDepositStep, type RelayRawQuote, type RelayStep } from "./quote-api.ts";

/** `protocol.v2.depository`, read from Relay's own chain list on 2026-09-09. */
export const RELAY_ROBINHOOD_DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
export const RELAY_SOLANA_DEPOSITORY_PROGRAM = "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2";

/** The ERC-20 `approve(address,uint256)` selector, for reading a proposed approval back. */
const APPROVE_SELECTOR = "0x095ea7b3";

/**
 * Relay states amounts in decimal; an EIP-1193 wallet takes a hex quantity,
 * and every other call in this product already carries one. Converting at the
 * boundary keeps `EvmCall` meaning one thing, rather than one thing per
 * provider — a wallet handed `"50000000000000000"` where it expects `0x…`
 * does not fail loudly, it sends a different amount.
 */
function hexQuantity(value: string | undefined): string {
  if (value === undefined || value === "") return "0x0";
  if (/^0x[0-9a-fA-F]+$/.test(value)) return value.toLowerCase();
  if (/^[0-9]+$/.test(value)) return `0x${BigInt(value).toString(16)}`;
  throw new TypeError(`${value} is not an amount.`);
}

export type RelaySolanaBuild =
  | Readonly<{
      ok: true;
      unsignedWireBase64: string;
      blockhash: string;
      lastValidBlockHeight: number;
      feePayer: string;
      requiredSignatures: number;
      instructionCount: number;
      lookupTableCount: number;
      programIds: readonly string[];
    }>
  | Readonly<{ ok: false; code: "ROUTE_SHAPE" | "BUILD_FAILED" | "SIGNER_SHAPE" | "UNEXPECTED_PROGRAM"; reason: string }>;

function solanaStepData(step: RelayStep): Readonly<{ instructions: readonly { programId: string; keys: readonly { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }[]; addressLookupTableAddresses?: readonly string[] }> | null {
  const data = step.items[0]?.data as Record<string, unknown> | undefined;
  if (!data || !Array.isArray(data.instructions)) return null;
  return data as never;
}

export async function buildRelaySolanaTransaction(args: {
  quote: RelayRawQuote;
  owner: string;
  rpcUrl: string;
}): Promise<RelaySolanaBuild> {
  const step = relayDepositStep(args.quote);
  if (!step) return { ok: false, code: "ROUTE_SHAPE", reason: "Relay's plan has no deposit step." };
  const data = solanaStepData(step);
  if (!data) return { ok: false, code: "ROUTE_SHAPE", reason: "Relay's deposit step is not a Solana transaction." };

  /* Every instruction must be Relay's depository program. A plan that reaches
     for anything else is not the plan this lane approved, whatever it says. */
  const foreign = data.instructions.map((instruction) => instruction.programId).filter((programId) => programId !== RELAY_SOLANA_DEPOSITORY_PROGRAM);
  if (foreign.length > 0) {
    return { ok: false, code: "UNEXPECTED_PROGRAM", reason: `Relay's plan invokes ${foreign.join(", ")}; only its depository program is signed from here.` };
  }

  const connection = new Connection(args.rpcUrl, "confirmed");
  let instructions: TransactionInstruction[];
  try {
    instructions = data.instructions.map(
      (instruction) =>
        new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: instruction.keys.map((key) => ({ pubkey: new PublicKey(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable })),
          data: Buffer.from(instruction.data, "hex"),
        }),
    );
  } catch (error) {
    return { ok: false, code: "BUILD_FAILED", reason: `Relay's instructions did not decode: ${error instanceof Error ? error.message : String(error)}` };
  }

  let lookupTables: AddressLookupTableAccount[] = [];
  const tableAddresses = data.addressLookupTableAddresses ?? [];
  if (tableAddresses.length > 0) {
    try {
      const fetched = await Promise.all(tableAddresses.map((address) => connection.getAddressLookupTable(new PublicKey(address))));
      const missing = tableAddresses.filter((_address, index) => fetched[index]?.value === null);
      if (missing.length > 0) {
        return { ok: false, code: "BUILD_FAILED", reason: `The cluster does not know lookup table ${missing.join(", ")}.` };
      }
      lookupTables = fetched.map((entry) => entry.value as AddressLookupTableAccount);
    } catch (error) {
      return { ok: false, code: "BUILD_FAILED", reason: `A lookup table could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed"));
  } catch (error) {
    return { ok: false, code: "BUILD_FAILED", reason: `The cluster did not give a blockhash: ${error instanceof Error ? error.message : String(error)}` };
  }

  const message = new TransactionMessage({ payerKey: new PublicKey(args.owner), recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
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
    instructionCount: instructions.length,
    lookupTableCount: lookupTables.length,
    programIds,
  };
}

export type RelayEvmBuild =
  | Readonly<{
      ok: true;
      chainId: number;
      calls: readonly EvmCall[];
      walletPrompts: number;
      allowance: Readonly<{ token: string; spender: string; currentRaw: string; requiredRaw: string; sufficient: boolean }> | null;
      gasPriceWei: string | null;
      totalMaximumCostWei: string | null;
    }>
  | Readonly<{ ok: false; code: "BUILD_FAILED" | "ROUTE_SHAPE" | "UNEXPECTED_TARGET"; reason: string }>;

type EvmStepData = Readonly<{ to: string; data: string; value: string; chainId: number; gas?: string; maxFeePerGas?: string }>;

function evmStepData(step: RelayStep): EvmStepData | null {
  const data = step.items[0]?.data as Record<string, unknown> | undefined;
  if (!data || typeof data.to !== "string" || typeof data.data !== "string") return null;
  return data as never;
}

/** The 32-byte word at `index` of a call's arguments, lower-cased and unpadded. */
function argWord(callData: string, index: number): string {
  const start = 10 + index * 64;
  return callData.slice(start, start + 64).toLowerCase();
}

export async function buildRelayEvmCalls(args: {
  quote: RelayRawQuote;
  owner: string;
  chainId: number;
  handle: EvmRpcHandle;
  /** Null for the native coin; the ERC-20 contract otherwise. */
  inputToken: string | null;
  amountRaw: string;
}): Promise<RelayEvmBuild> {
  const deposit = relayDepositStep(args.quote);
  if (!deposit) return { ok: false, code: "ROUTE_SHAPE", reason: "Relay's plan has no deposit step." };
  const depositData = evmStepData(deposit);
  if (!depositData) return { ok: false, code: "ROUTE_SHAPE", reason: "Relay's deposit step is not an EVM call." };
  if (depositData.to.toLowerCase() !== RELAY_ROBINHOOD_DEPOSITORY) {
    return { ok: false, code: "UNEXPECTED_TARGET", reason: "The deposit does not target Relay's published depository; nothing else is signed from here." };
  }
  if (depositData.chainId !== args.chainId) {
    return { ok: false, code: "ROUTE_SHAPE", reason: `Relay built the call for chain ${depositData.chainId}, not ${args.chainId}.` };
  }

  const approvalSteps = args.quote.steps.filter((step) => step.id === "approve" || step.id === "approval");
  if (approvalSteps.length !== relayApprovalCount(args.quote)) {
    return { ok: false, code: "ROUTE_SHAPE", reason: "Relay's plan disagrees with itself about approvals." };
  }
  if (approvalSteps.length > 0 && !args.inputToken) {
    return { ok: false, code: "ROUTE_SHAPE", reason: "Relay asks to approve a token for a native-coin swap." };
  }

  const gasPrice = await baseRpcCall<string>(args.handle, "eth_gasPrice", []);
  const gasPriceWei = gasPrice.ok ? hexQuantityToDecimal(gasPrice.value) : null;

  const calls: EvmCall[] = [];
  let allowance: Extract<RelayEvmBuild, { ok: true }>["allowance"] = null;

  for (const step of approvalSteps) {
    const stepData = evmStepData(step);
    if (!stepData) return { ok: false, code: "ROUTE_SHAPE", reason: "Relay's approval step is not an EVM call." };
    if (stepData.to.toLowerCase() !== (args.inputToken as string).toLowerCase()) {
      return { ok: false, code: "UNEXPECTED_TARGET", reason: "The approval does not target the token being spent." };
    }
    if (!stepData.data.toLowerCase().startsWith(APPROVE_SELECTOR)) {
      return { ok: false, code: "UNEXPECTED_TARGET", reason: "The approval call is not an ERC-20 approve." };
    }
    /* An approval names a spender and an amount, and both are read back rather
       than trusted: the spender must be the same depository the deposit goes
       to, and the amount must not exceed what this swap actually spends. An
       unlimited approval is the one a person never gets asked for here. */
    const spender = argWord(stepData.data, 0);
    if (!spender.endsWith(RELAY_ROBINHOOD_DEPOSITORY.slice(2))) {
      return { ok: false, code: "UNEXPECTED_TARGET", reason: "The approval names a spender that is not Relay's depository." };
    }
    const approved = BigInt(`0x${argWord(stepData.data, 1)}`);
    if (approved > BigInt(args.amountRaw)) {
      return { ok: false, code: "UNEXPECTED_TARGET", reason: "The approval is for more than this swap spends." };
    }
    /* What the chain says the allowance is, not what the provider assumes.
       Relay includes an approval step whenever it would need one; reading
       the current allowance is how the Review can say whether the prompt is
       real, and how a stale plan is caught before a wallet opens. */
    const read = await readBaseErc20Allowance(args.handle, { token: args.inputToken as string, owner: args.owner, spender: RELAY_ROBINHOOD_DEPOSITORY });
    if (!read.ok) return { ok: false, code: "BUILD_FAILED", reason: read.reason };
    allowance = {
      token: args.inputToken as string,
      spender: RELAY_ROBINHOOD_DEPOSITORY,
      currentRaw: read.raw,
      requiredRaw: args.amountRaw,
      sufficient: BigInt(read.raw) >= BigInt(args.amountRaw),
    };
    calls.push(pricedFromQuote("APPROVE", stepData, gasPriceWei));
  }

  calls.push(
    approvalSteps.length === 0
      ? await pricedFromChain("SWAP", depositData, args.owner, args.handle, gasPriceWei)
      : /* Estimating a spend the token has not yet approved reverts, and a
           revert is not a price. Relay's own figure is used and labelled. */
        pricedFromQuote("SWAP", depositData, gasPriceWei),
  );

  const total = calls.every((call) => call.maximumCostWei !== null) ? calls.reduce((sum, call) => sum + BigInt(call.maximumCostWei as string), 0n).toString() : null;
  return { ok: true, chainId: args.chainId, calls, walletPrompts: calls.length, allowance, gasPriceWei, totalMaximumCostWei: total };
}

function pricedFromQuote(purpose: EvmCall["purpose"], step: EvmStepData, gasPriceWei: string | null): EvmCall {
  const gasEstimate = step.gas ?? null;
  const feeCap = step.maxFeePerGas ?? gasPriceWei;
  return {
    purpose,
    to: step.to,
    data: step.data,
    value: hexQuantity(step.value),
    gasEstimate,
    maximumCostWei: gasEstimate !== null && feeCap !== null ? (BigInt(gasEstimate) * BigInt(feeCap)).toString() : null,
    unpricedReason: gasEstimate === null ? "Relay stated no gas for this call." : null,
  };
}

async function pricedFromChain(purpose: EvmCall["purpose"], step: EvmStepData, owner: string, handle: EvmRpcHandle, gasPriceWei: string | null): Promise<EvmCall> {
  const value = hexQuantity(step.value);
  const estimate = await baseRpcCall<string>(handle, "eth_estimateGas", [{ from: owner, to: step.to, data: step.data, value }]);
  const gasEstimate = estimate.ok ? hexQuantityToDecimal(estimate.value) : (step.gas ?? null);
  return {
    purpose,
    to: step.to,
    data: step.data,
    value,
    gasEstimate,
    maximumCostWei: gasEstimate !== null && gasPriceWei !== null ? (BigInt(gasEstimate) * BigInt(gasPriceWei)).toString() : null,
    unpricedReason: gasEstimate !== null ? null : estimate.ok ? "The node returned a gas estimate that is not a quantity." : estimate.reason,
  };
}
