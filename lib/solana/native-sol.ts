/**
 * Native SOL transfer — System Program `Transfer`, never a mint.
 *
 * Wrapped SOL (`So111…112`) is a different asset: an SPL token whose supply
 * is SOL that someone wrapped. Sending native SOL does not touch that mint,
 * does not create an ATA, and has no transfer fee or hook. Canon §10.3
 * makes that its own action type so a token-transfer proof cannot be read
 * as a SOL-transfer proof.
 *
 * Outside the public evidence kit, like `transaction.ts`.
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
  type Instruction,
} from "@solana/kit";

import type { NativeSolTransferInput } from "../agent-control/adapters/solana-token-2022.ts";
import { parseSolanaAddress } from "./address.ts";
import type { SplTransferPreflight } from "./contracts.ts";
import { NATIVE_SOL_DECIMALS, SYSTEM_PROGRAM_ID } from "./send-kinds.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";
import { resolveNativeRecipient } from "./send-recipient.ts";
import { classifySendSupport, sendSupportInputFromFacts } from "./send-support.ts";
import { readBaseFeeLamports, type TransferBuildFailure, type TransferPlan } from "./transaction.ts";

export const SYSTEM_PROGRAM_ADDRESS = SYSTEM_PROGRAM_ID as Address;

/** System Program instruction index 2: Transfer { lamports: u64 }. */
const SYSTEM_TRANSFER_INDEX = 2;

/**
 * Kit's AccountRole numeric values (WRITABLE_SIGNER = 3, WRITABLE = 1).
 * Imported as numbers so this file does not take a new package for four
 * bytes of well-specified program data.
 */
const WRITABLE_SIGNER = 3;
const WRITABLE = 1;
const READONLY = 0;

export function nativeSolTransferInstruction(args: {
  source: Address;
  destination: Address;
  lamports: bigint;
  /**
   * Solana Pay reference keys (RYN-PAY-REQUEST-001): read-only, non-signer
   * accounts appended to the transfer so `getSignaturesForAddress(reference)`
   * finds exactly the transaction that paid one request. They move nothing and
   * are never the recipient; the System Program ignores extra accounts.
   */
  references?: readonly Address[];
}): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, SYSTEM_TRANSFER_INDEX, true);
  view.setBigUint64(4, args.lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: args.source, role: WRITABLE_SIGNER },
      { address: args.destination, role: WRITABLE },
      ...(args.references ?? []).map((address) => ({ address, role: READONLY })),
    ],
    data,
  } as Instruction;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type NativeSolBuildResult = Readonly<{ ok: true; plan: TransferPlan }> | TransferBuildFailure;

/**
 * Build a native SOL transfer. Never throws.
 *
 * A destination that does not exist yet is fundable by this instruction —
 * System Program creates the account if the lamports cover rent. That is
 * recorded on the plan as `createsRecipientAccount`, and it is still the
 * native-SOL action type, not TOKEN_ATA_CREATE.
 */
export async function buildNativeSolTransaction(args: {
  handle: SolanaRpcHandle;
  input: NativeSolTransferInput;
  now?: Date;
  /** Solana Pay reference keys carried as read-only accounts; see `nativeSolTransferInstruction`. */
  references?: readonly string[];
}): Promise<NativeSolBuildResult> {
  const { handle, input } = args;
  const senderParsed = parseSolanaAddress(input.sender, "sender");
  const recipientParsed = parseSolanaAddress(input.recipient, "recipient");
  if (!senderParsed.ok) {
    return { ok: false, code: "BUILD_FAILED", reason: senderParsed.reason };
  }
  if (!recipientParsed.ok) {
    return { ok: false, code: "BUILD_FAILED", reason: recipientParsed.reason };
  }
  if (input.sender === input.recipient) {
    return {
      ok: false,
      code: "BUILD_FAILED",
      reason: "The sender and the recipient are the same account; there is nothing to transfer.",
    };
  }

  let senderLamports: bigint;
  try {
    const balance = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getBalance(input.sender as never).send({ abortSignal }),
    );
    senderLamports = BigInt(balance.value);
  } catch (failure) {
    return {
      ok: false,
      code: "BUILD_FAILED",
      reason: `The endpoint did not return the sender's SOL balance: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }

  const amount = BigInt(input.amountRaw);
  if (senderLamports < amount) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      reason: `The sender holds ${senderLamports.toString()} lamports and the transfer asks for ${input.amountRaw}. This is read from the chain at build time, not assumed.`,
    };
  }

  /* Classify before building. Lamports sent to a program-owned or off-curve
     address are not recoverable by anyone, and that is decided by one account
     read rather than by hoping the person pasted a wallet. */
  const recipient = await resolveNativeRecipient(handle, input.recipient);
  if (!recipient.ok) {
    return { ok: false, code: "BUILD_FAILED", reason: recipient.reason };
  }
  const recipientExists = !recipient.createsAccount;

  let ataRentLamports: string | null = null;
  if (!recipientExists) {
    try {
      const rent = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getMinimumBalanceForRentExemption(0n).send({ abortSignal }),
      );
      ataRentLamports = String(rent);
      if (amount < BigInt(ataRentLamports)) {
        return {
          ok: false,
          code: "INSUFFICIENT_BALANCE",
          reason: `The recipient account does not exist yet, so this transfer must carry at least ${ataRentLamports} lamports of rent. ${input.amountRaw} is below that.`,
        };
      }
    } catch {
      ataRentLamports = null;
    }
  }

  let blockhash: string;
  let lastValidBlockHeight: string;
  try {
    const latest = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getLatestBlockhash({ commitment: "confirmed" }).send({ abortSignal }),
    );
    blockhash = String(latest.value.blockhash);
    lastValidBlockHeight = String(latest.value.lastValidBlockHeight);
  } catch (failure) {
    return {
      ok: false,
      code: "BLOCKHASH_UNAVAILABLE",
      reason: `The endpoint did not return a recent blockhash, so no transaction can be built with a valid lifetime: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }

  try {
    const instruction = nativeSolTransferInstruction({
      source: input.sender as Address,
      destination: input.recipient as Address,
      lamports: amount,
      references: (args.references ?? []).map((reference) => reference as Address),
    });
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayer(input.sender as Address, draft),
      (draft) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash as Blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
          draft,
        ),
      (draft) => appendTransactionMessageInstructions([instruction], draft),
    );
    const compiled = compileTransaction(message);
    const unsignedWireBase64 = getBase64EncodedWireTransaction(compiled);
    const baseFee = await readBaseFeeLamports(
      handle,
      compiled.messageBytes as unknown as Uint8Array,
    );
    if (!baseFee.ok) return baseFee;
    const requiredLamports = amount + BigInt(baseFee.lamports);
    if (senderLamports < requiredLamports) {
      return {
        ok: false,
        code: "INSUFFICIENT_FEE_BALANCE",
        reason: `The sender holds ${senderLamports.toString()} lamports, but ${input.amountRaw} plus the exact ${baseFee.lamports}-lamport base fee requires ${requiredLamports.toString()}.`,
      };
    }

    const nativeLeg = {
      programAddress: String(SYSTEM_PROGRAM_ADDRESS),
      source: input.sender,
      mint: String(SYSTEM_PROGRAM_ADDRESS),
      destination: input.recipient,
      authority: input.sender,
      amountRaw: input.amountRaw,
      decimals: NATIVE_SOL_DECIMALS,
    };

    return {
      ok: true,
      plan: {
        actionKind: "NATIVE_SOL",
        network: input.network,
        mint: SYSTEM_PROGRAM_ADDRESS,
        tokenProgram: SYSTEM_PROGRAM_ADDRESS,
        decimals: NATIVE_SOL_DECIMALS,
        sender: input.sender,
        recipient: input.recipient,
        senderTokenAccount: input.sender,
        recipientTokenAccount: input.recipient,
        /* Native SOL moves lamports on the owner's own account, so there is
           exactly one source and it is never a token account. */
        sources: [{ account: input.sender, amountRaw: input.amountRaw, feeRaw: "0" }],
        recipientKind: "WALLET_OWNER",
        /* Lamports land on the address itself, so the account and its owner
           are the same key here. */
        recipientOwner: input.recipient,
        memo: null,
        transferHook: null,
        /* No mint, so no mint facts. The classifier is told that plainly
           rather than handed an empty passport that would read as "checked
           and found nothing". */
        support: classifySendSupport(
          sendSupportInputFromFacts({
            actionKind: "NATIVE_SOL",
            passport: null,
            preflight: null,
            sourceStates: ["INITIALIZED"],
            destination: { createsAccount: !recipientExists, state: null },
            transferHookExtraAccountsResolved: false,
            memoTransferRequired: false,
          }),
        ),
        createsRecipientAccount: !recipientExists,
        ataRentLamports,
        amountRaw: input.amountRaw,
        senderBalanceRaw: senderLamports.toString(),
        baseFeeLamports: baseFee.lamports,
        priorityFeeLamports: "0",
        programs: [String(SYSTEM_PROGRAM_ADDRESS)],
        blockhash,
        lastValidBlockHeight,
        unsignedWireBase64,
        fingerprint: {
          messageHash: await sha256Hex(compiled.messageBytes as unknown as Uint8Array),
          feePayer: input.sender,
          blockhash,
          instructionCount: 1,
          transfer: nativeLeg,
          transfers: [nativeLeg],
        },
        builtAt: (args.now ?? new Date()).toISOString(),
      },
    };
  } catch (failure) {
    return {
      ok: false,
      code: "BUILD_FAILED",
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
}

/**
 * Native SOL preview. Same published preflight shape as a token transfer so
 * Review can render one desk, with mint/program set to the System Program
 * and every token-only field honestly empty.
 */
export function buildNativeSolPreflight(args: {
  input: NativeSolTransferInput;
  plan: TransferPlan;
  simulation: SplTransferPreflight["simulation"];
  observedAt?: string;
}): SplTransferPreflight {
  const { input, plan, simulation } = args;
  return {
    schema: "ryntra.solana.spl-transfer-preflight",
    schemaVersion: "0.1.0",
    network: input.network,
    mint: SYSTEM_PROGRAM_ADDRESS,
    sender: input.sender,
    recipient: input.recipient,
    amountRequestedRaw: input.amountRaw,
    transferFee: {
      feeRaw: "0",
      basisPoints: 0,
      maximumFeeRaw: "0",
      capApplied: false,
      configUsed: "NONE",
      epochBasis: null,
    },
    estimatedReceivedRaw: input.amountRaw,
    expectedBalanceDeltas: [
      { account: input.sender, mint: SYSTEM_PROGRAM_ADDRESS, rawDelta: `-${input.amountRaw}` },
      { account: input.recipient, mint: SYSTEM_PROGRAM_ADDRESS, rawDelta: input.amountRaw },
    ],
    feeWithheldRaw: "0",
    hookProgramId: null,
    structuralBlockers: [],
    unsupportedKinds: [],
    networkFeeLamports: plan.baseFeeLamports,
    computeBudget:
      simulation.status === "PRESENT" && simulation.unitsConsumed ? simulation.unitsConsumed : null,
    unfilledReason:
      "The exact base fee is priced from the reviewed message; M0C adds no priority-fee instruction, so priority fee is zero.",
    simulation,
    observedAt: args.observedAt ?? plan.builtAt,
  };
}
