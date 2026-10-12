/**
 * Turn one narrowly accepted Wallet Standard modification into a new exact
 * Review candidate.
 *
 * The wallet has already signed these bytes. Before the one-action flow can
 * enter settlement, the server prices and simulates the wallet's exact message,
 * replaces the old unsigned candidate with these message bytes, records the
 * augmentation provenance and issues a fresh review proof. Settlement then
 * returns to its original invariant: the submitted message hash must exactly
 * equal the reviewed message hash.
 */

import { createHash } from "node:crypto";
import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";

import type { TransferPlan } from "./transaction.ts";
import {
  compareWalletTransaction,
  type WalletTransactionComparison,
} from "./wallet-modification.ts";

const RAW = /^(0|[1-9][0-9]*)$/;

/**
 * The deployment's ceiling on a wallet-added priority fee.
 *
 * $0.01 at $100/SOL, deliberately tiny and independently repriced. It was
 * named and described as "the M1B adoption cap", which put an internal canary's
 * name into a refusal an ordinary sender could meet on any congested minute.
 */
export const MAX_WALLET_PRIORITY_FEE_LAMPORTS = "100000";

type AdoptionFailureCode =
  | "WALLET_MODIFICATION_REJECTED"
  | "WALLET_PRIORITY_FEE_INVALID"
  | "WALLET_PRIORITY_FEE_TOO_HIGH"
  | "WALLET_FEE_MISMATCH"
  | "WALLET_TRANSACTION_UNREADABLE";

export type WalletAdoptionResult =
  | Readonly<{
      ok: true;
      plan: TransferPlan;
      comparison: WalletTransactionComparison;
    }>
  | Readonly<{
      ok: false;
      code: AdoptionFailureCode;
      reason: string;
    }>;

function failure(code: AdoptionFailureCode, reason: string): WalletAdoptionResult {
  return { ok: false, code, reason };
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function messageHash(bytes: Uint8Array): string {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

type DecodedMessage = Readonly<{
  staticAccounts: readonly string[];
  instructions: readonly Readonly<{ programAddressIndex: number }>[];
}>;

function outerPrograms(message: DecodedMessage): readonly string[] {
  const seen = new Set<string>();
  const programs: string[] = [];
  for (const instruction of message.instructions) {
    const program = String(message.staticAccounts[instruction.programAddressIndex] ?? "");
    if (!program || seen.has(program)) continue;
    seen.add(program);
    programs.push(program);
  }
  return programs;
}

/**
 * Materialise the wallet's message as an unsigned exact plan.
 *
 * `totalFeeLamports` comes from `getFeeForMessage` over these exact message
 * bytes. The function refuses a fee that disagrees with the decoded
 * ComputeBudget request, even when both values are below the cap.
 */
export async function adoptWalletTransactionPlan(args: {
  plan: TransferPlan;
  signedWireBase64: string;
  totalFeeLamports: string;
  now?: Date;
}): Promise<WalletAdoptionResult> {
  const comparison = compareWalletTransaction({
    expectedWireBase64: args.plan.unsignedWireBase64,
    actualWireBase64: args.signedWireBase64,
    /* A native SOL message has no token account, so the wallet writes one
       assertion rather than a pair. */
    expectsTokenGuard: args.plan.actionKind !== "NATIVE_SOL",
  });
  if (comparison.verdict !== "WALLET_GUARDS_ONLY" || comparison.computeBudget === null) {
    return failure(
      "WALLET_MODIFICATION_REJECTED",
      comparison.detail,
    );
  }
  if (!RAW.test(args.totalFeeLamports) || !RAW.test(args.plan.baseFeeLamports)) {
    return failure(
      "WALLET_PRIORITY_FEE_INVALID",
      "The exact wallet-modified network fee is not a canonical lamport amount.",
    );
  }
  const totalFee = BigInt(args.totalFeeLamports);
  const baseFee = BigInt(args.plan.baseFeeLamports);
  if (totalFee < baseFee) {
    return failure(
      "WALLET_PRIORITY_FEE_INVALID",
      "The wallet-modified total network fee is lower than the reviewed base signature fee.",
    );
  }
  const priorityFee = totalFee - baseFee;
  if (priorityFee > BigInt(MAX_WALLET_PRIORITY_FEE_LAMPORTS)) {
    return failure(
      "WALLET_PRIORITY_FEE_TOO_HIGH",
      `Your wallet asked to add ${(Number(priorityFee) / 1e9).toFixed(6)} SOL of priority fee, and this deployment accepts at most ${(Number(MAX_WALLET_PRIORITY_FEE_LAMPORTS) / 1e9).toFixed(6)} SOL. Nothing was sent.`,
    );
  }
  if (priorityFee !== BigInt(comparison.computeBudget.maximumPriorityFeeLamports)) {
    return failure(
      "WALLET_FEE_MISMATCH",
      `The RPC priced ${priorityFee.toString()} priority-fee lamports, while the decoded ComputeBudget request implies ${comparison.computeBudget.maximumPriorityFeeLamports}.`,
    );
  }

  try {
    const decoded = getTransactionDecoder().decode(fromBase64(args.signedWireBase64));
    const messageBytes = decoded.messageBytes as unknown as Uint8Array;
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes) as unknown as DecodedMessage;
    const unsigned = getTransactionEncoder().encode({
      messageBytes: decoded.messageBytes,
      signatures: Object.fromEntries(
        Object.keys(decoded.signatures).map((signer) => [signer, null]),
      ) as typeof decoded.signatures,
    });

    return {
      ok: true,
      comparison,
      plan: {
        ...args.plan,
        priorityFeeLamports: priorityFee.toString(),
        walletAugmentation: {
          computeUnitLimit: comparison.computeBudget.unitLimit,
          microLamportsPerUnit: comparison.computeBudget.microLamportsPerUnit,
          maximumPriorityFeeLamports: priorityFee.toString(),
          lighthouseAssertions: comparison.lighthouseAssertions.map((assertion) => ({ ...assertion })),
        },
        programs: outerPrograms(message),
        unsignedWireBase64: Buffer.from(unsigned).toString("base64"),
        fingerprint: {
          ...args.plan.fingerprint,
          messageHash: messageHash(messageBytes),
          instructionCount: message.instructions.length,
        },
        builtAt: (args.now ?? new Date()).toISOString(),
      },
    };
  } catch (cause) {
    return failure(
      "WALLET_TRANSACTION_UNREADABLE",
      `The accepted wallet transaction could not be materialised as an exact Review candidate: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
