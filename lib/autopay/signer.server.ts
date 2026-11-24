/**
 * The executor's signer for autopay: the agent's key (the registry's `AGENT_SIGNER`, its key in Google Cloud
 * KMS — `KeySigner` from `../launch/signer/signer.server.ts`, chosen as the agent's budget chooses it), and the bounds
 * it signs within, read from the message's own bytes every time — whatever the caller says the bytes do:
 *
 * - the executor pays and is the transaction's only signer;
 * - outside the execution only the compute budget, at most `PAYMENT_COMPUTE_UNITS` and `PAYMENT_UNIT_PRICE_MAX`;
 * - exactly one execution, through this autopay's policy, on this autopay's vault, signed by the executor alone, one
 *   inner instruction meeting the policy's one rule (`../mandate/judge.ts` — the program's own reading): from the vault,
 *   to the named address, exactly the amount;
 * - the schedule: the autopay is working, the moment falls in a window of the schedule — not before the first, not after
 *   the last — and the window asked for is the one the moment falls in, its payment not made or tried before.
 *
 * The chain holds the same rules again and is the authority (`./policy.ts`): this signer keeps the executor from signing,
 * or paying the fee for, what the program would refuse — or what a bug of ours built. No journal row, no signature.
 */

import { createHash } from "node:crypto";
import { ComputeBudgetProgram, TransactionMessage, VersionedMessage, type AddressLookupTableAccount } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { readCarePolicyExecute } from "../care/ssa-care.ts";
import type { KeySigner, LaunchSignerMode } from "../launch/signer/signer.server.ts";
import { instructionRefusal } from "../mandate/judge.ts";
import { SSA_PROGRAM_ID } from "../mandate/ssa.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { PAYMENT_COMPUTE_UNITS, PAYMENT_UNIT_PRICE_MAX, type Autopay } from "./enable.ts";
import { paymentConstraint } from "./policy.ts";
import { windowAt } from "./schedule.ts";

export class AutopaySignerRefused extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`The executor refuses to sign: ${reason}.`);
    this.name = "AutopaySignerRefused";
    this.reason = reason;
  }
}

export type AutopayStatus = "working" | "stopped" | "ended";

export type PaymentRequest = Readonly<{
  /** The window whose payment this is. */
  window: number;
  /** The chain's time now, Unix seconds. */
  nowSeconds: bigint;
  /** The book's state of the autopay. */
  status: AutopayStatus;
  /** Windows whose payment was made or tried already. */
  done: ReadonlySet<number>;
  lookupTables?: readonly AddressLookupTableAccount[];
}>;

const NO_FACTS = new Map();

function numberAt(data: Uint8Array, from: number, size: number): bigint {
  let out = 0n;
  for (let i = from + size - 1; i >= from; i -= 1) out = (out << 8n) | BigInt(data[i] ?? 0);
  return out;
}

/** Why the schedule refuses this payment now; null when it is due. */
export function scheduleRefusal(autopay: Autopay, request: Pick<PaymentRequest, "window" | "nowSeconds" | "status" | "done">): string | null {
  if (request.status !== "working") return "the autopay is not working";
  const { schedule } = autopay.terms;
  if (request.nowSeconds < schedule.startAt) return "the first payment is not due yet";
  const window = windowAt(schedule, request.nowSeconds);
  if (window === null) return "the autopay has ended";
  if (request.window !== window) return "the payment asked for is not the one due now";
  if (request.done.has(window)) return "this window's payment was made already";
  return null;
}

/** Why the message is not this autopay's payment, now; null when it is. */
export function paymentRefusal(message: Uint8Array, autopay: Autopay, request: PaymentRequest): string | null {
  const due = scheduleRefusal(autopay, request);
  if (due) return due;
  let decoded: VersionedMessage;
  try {
    decoded = VersionedMessage.deserialize(message);
  } catch (error) {
    return `not a transaction message (${error instanceof Error ? error.message.split("\n")[0] : "unreadable"})`;
  }
  const { agent } = autopay.terms;
  if (!decoded.staticAccountKeys[0]?.equals(agent)) return "the executor does not pay this transaction";
  if (decoded.header.numRequiredSignatures !== 1) return "the transaction has signers other than the executor";
  let instructions;
  try {
    instructions = TransactionMessage.decompile(decoded, { addressLookupTableAccounts: [...(request.lookupTables ?? [])] }).instructions;
  } catch {
    return "the message names lookup tables it was not handed";
  }
  const rule = paymentConstraint(autopay.terms, autopay.vault);
  let executions = 0;
  for (const instruction of instructions) {
    const program = instruction.programId;
    if (program.equals(ComputeBudgetProgram.programId)) {
      const kind = instruction.data[0];
      if (kind === 2 && instruction.data.length === 5 && numberAt(instruction.data, 1, 4) <= BigInt(PAYMENT_COMPUTE_UNITS)) continue;
      if (kind === 3 && instruction.data.length === 9 && numberAt(instruction.data, 1, 8) <= PAYMENT_UNIT_PRICE_MAX) continue;
      return "the compute budget is outside the executor's ceiling";
    }
    if (program.equals(SSA_PROGRAM_ID)) {
      executions += 1;
      let view;
      try {
        view = readCarePolicyExecute({ programId: program, keys: instruction.keys.map((key) => key.pubkey), data: instruction.data });
      } catch (error) {
        return `the execution is not an autopay's (${error instanceof Error ? error.message : "unreadable"})`;
      }
      if (!view.policy.equals(autopay.policy)) return "the execution runs under a policy that is not this autopay's";
      if (view.accountIndex !== autopay.vaultIndex) return "the execution acts on another vault";
      if (view.signers.length !== 1 || !view.signers[0]!.equals(agent)) return "the execution is not signed by the executor alone";
      if (view.instructions.length !== 1 || view.constraintIndices.length !== 1 || view.constraintIndices[0] !== 0) return "the execution is not exactly one payment";
      const refusal = instructionRefusal(view.instructions[0]!, rule, NO_FACTS);
      if (refusal) return `the payment breaks the autopay's rule: ${refusal}`;
      continue;
    }
    return "an instruction outside the payment";
  }
  if (executions !== 1) return "not exactly one payment";
  return null;
}

export type AutopaySignatureRow = Readonly<{
  v: 1;
  cluster: string;
  role: "agent";
  mode: LaunchSignerMode;
  signer: string;
  keyRef: string | null;
  policy: string;
  action: "autopay.payment";
  window: number;
  messageSha256: string;
  signature: string | null;
  outcome: "SIGNED" | "REFUSED";
  reason: string | null;
  at: string;
}>;

export type AutopayJournal = (row: AutopaySignatureRow) => Promise<void>;

export const NO_AUTOPAY_JOURNAL: AutopayJournal = async () => {
  throw new Error("no signing journal here");
};

export type AutopaySigner = Readonly<{
  publicKey: Autopay["terms"]["agent"];
  /** The executor's signature over the message, once the bounds allow it and the journal kept it; throws `AutopaySignerRefused` otherwise. */
  signMessage(message: Uint8Array, request: PaymentRequest): Promise<Uint8Array>;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function autopaySigner(key: KeySigner, options: Readonly<{ autopay: Autopay; journal: AutopayJournal; now?: () => Date }>): AutopaySigner {
  const { autopay } = options;
  const publicKey = autopay.terms.agent;
  const now = options.now ?? (() => new Date());
  const row = (fields: Pick<AutopaySignatureRow, "messageSha256" | "signature" | "outcome" | "reason" | "window">): AutopaySignatureRow => ({
    v: 1,
    cluster: autopay.terms.network,
    role: "agent",
    mode: key.mode,
    signer: publicKey.toBase58(),
    keyRef: key.keyRef,
    policy: autopay.policy.toBase58(),
    action: "autopay.payment",
    ...fields,
    at: now().toISOString(),
  });
  return {
    publicKey,
    async signMessage(message, request) {
      const messageSha256 = sha256(message);
      const refusal = paymentRefusal(message, autopay, request);
      if (refusal) {
        await options.journal(row({ messageSha256, signature: null, outcome: "REFUSED", reason: refusal, window: request.window })).catch(() => undefined);
        throw new AutopaySignerRefused(refusal);
      }
      const signature = await key.sign(message);
      /* The key's fault, not the payment's: no signature leaves, and the window is tried again (not a refusal). */
      if (signature.length !== 64 || !ed25519Valid(message, signature, publicKey)) throw new Error("the key's signature does not verify against the executor's address");
      await options.journal(row({ messageSha256, signature: getBase58Decoder().decode(signature), outcome: "SIGNED", reason: null, window: request.window }));
      return signature;
    },
  };
}
