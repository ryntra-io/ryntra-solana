/**
 * CITY-203 — the agent's signer for the care: the same key as the agent's budget (the registry's `AGENT_SIGNER`, its key
 * in Google Cloud KMS — `KeySigner` from `../launch/signer/signer.server.ts`), and the bounds it signs within, read from
 * the message's own bytes every time (CITY-162's rule — whatever the caller says the bytes do):
 *
 * - the agent pays; besides it, at most one more signer — the fresh key of a new position (DLMM) or its NFT's mint
 *   (DAMM v2), and only when the execution opens exactly that position;
 * - outside the execution only the compute budget (at most 1.4 M units, a 256 KB heap, a capped price), token accounts
 *   the agent opens and pays for the person or the vault, and DLMM bin arrays of the person's pool it funds;
 * - exactly one execution through one of this care's two policies, signed by the agent, each inner instruction meeting
 *   the policy's rule it names (`../mandate/judge.ts` — the program's own reading).
 *
 * The chain holds the same rules again and is the authority: this signer keeps the agent from signing, or paying for,
 * what the program would refuse — or what a bug of ours built. No journal row, no signature.
 */

import { createHash } from "node:crypto";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedMessage, type AddressLookupTableAccount } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import type { KeySigner, LaunchSignerMode } from "../launch/signer/signer.server.ts";
import { AGENT_COMPUTE_UNIT_LIMIT, AGENT_HEAP_BYTES, AGENT_UNIT_PRICE_MAX } from "../mandate/agent.ts";
import { instructionRefusal, type AccountFacts } from "../mandate/judge.ts";
import { SSA_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../mandate/ssa.ts";
import type { Care } from "./enable.ts";
import { readCarePolicyExecute } from "./ssa-care.ts";
import { DISC, DLMM_PROGRAM_ID, LAYOUT, TOKEN_2022_PROGRAM_ID, carePolicies } from "./terms.ts";

const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const DLMM_INIT_BIN_ARRAY = Uint8Array.of(35, 86, 19, 185, 78, 212, 75, 211);

export class CareSignerRefused extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`The agent refuses to sign: ${reason}.`);
    this.name = "CareSignerRefused";
    this.reason = reason;
  }
}

export type CareSignRequest = Readonly<{ lookupTables?: readonly AddressLookupTableAccount[]; facts: AccountFacts }>;

const head = (data: Uint8Array, disc: Uint8Array) => disc.length <= data.length && disc.every((byte, index) => data[index] === byte);

/** Why the message is not an action this care's agent signs; null when it is. */
export function careRefusal(message: Uint8Array, care: Care, request: CareSignRequest): string | null {
  let decoded: VersionedMessage;
  try {
    decoded = VersionedMessage.deserialize(message);
  } catch (error) {
    return `not a transaction message (${error instanceof Error ? error.message.split("\n")[0] : "unreadable"})`;
  }
  const { agent, human, pool } = care.terms;
  if (!decoded.staticAccountKeys[0]?.equals(agent)) return "the agent does not pay this transaction";
  const signerCount = decoded.header.numRequiredSignatures;
  if (signerCount < 1 || signerCount > 2) return "the transaction has signers other than the agent and one fresh key";
  const extraSigner = signerCount === 2 ? decoded.staticAccountKeys[1]! : null;
  let instructions;
  try {
    instructions = TransactionMessage.decompile(decoded, { addressLookupTableAccounts: [...(request.lookupTables ?? [])] }).instructions;
  } catch {
    return "the message names lookup tables it was not handed";
  }
  const policies = carePolicies(care.terms, care.vault, care.vaultIndex);
  const owners = [human, care.vault];
  const tokenPrograms = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  let executions = 0;
  let opened: PublicKey | null = null;
  for (const instruction of instructions) {
    const program = instruction.programId;
    if (program.equals(ComputeBudgetProgram.programId)) {
      const kind = instruction.data[0];
      const value = (size: number) => {
        let out = 0n;
        for (let i = size; i >= 1; i -= 1) out = (out << 8n) | BigInt(instruction.data[i] ?? 0);
        return out;
      };
      if (kind === 2 && value(4) <= BigInt(AGENT_COMPUTE_UNIT_LIMIT)) continue;
      if (kind === 1 && value(4) <= BigInt(AGENT_HEAP_BYTES)) continue;
      if (kind === 3 && value(8) <= AGENT_UNIT_PRICE_MAX) continue;
      return "the compute budget is outside the agent's ceiling";
    }
    if (program.equals(ASSOCIATED_TOKEN_PROGRAM)) {
      /* CreateIdempotent: payer, account, owner, mint, system, token program — for the person or the vault, paid by the agent. */
      const [payer, account, owner, mint, , tokenProgram] = instruction.keys.map((key) => key.pubkey);
      if (instruction.data.length !== 1 || instruction.data[0] !== 1) return "a token account is opened other than idempotently";
      if (!payer?.equals(agent)) return "a token account is paid by someone other than the agent";
      if (!owner || !owners.some((entry) => entry.equals(owner))) return "a token account is opened for someone other than the person or the vault";
      if (!mint || !tokenProgram || !tokenPrograms.some((entry) => entry.equals(tokenProgram))) return "a token account of an unknown program";
      if (!account?.equals(getAssociatedTokenAddressSync(mint, owner, true, tokenProgram))) return "a token account is not the owner's own";
      continue;
    }
    if (program.equals(DLMM_PROGRAM_ID) && head(instruction.data, DLMM_INIT_BIN_ARRAY)) {
      if (pool.kind !== "dlmm") return "a bin array outside the care's pool";
      if (!instruction.keys[0]?.pubkey.equals(pool.address)) return "a bin array of another pool";
      if (!instruction.keys[2]?.pubkey.equals(agent)) return "a bin array is funded by someone other than the agent";
      continue;
    }
    if (program.equals(SSA_PROGRAM_ID)) {
      executions += 1;
      let view;
      try {
        view = readCarePolicyExecute({ programId: program, keys: instruction.keys.map((key) => key.pubkey), data: instruction.data });
      } catch (error) {
        return `the execution is not the care's (${error instanceof Error ? error.message : "unreadable"})`;
      }
      const which = view.policy.equals(care.exitPolicy) ? "exit" : view.policy.equals(care.tendPolicy) ? "tend" : null;
      if (!which) return "the execution runs under a policy that is not this care's";
      if (view.accountIndex !== care.vaultIndex) return "the execution acts on another vault";
      if (view.signers.length !== 1 || !view.signers[0]!.equals(agent)) return "the execution is not signed by the agent alone";
      if (view.constraintIndices.length !== view.instructions.length || !view.instructions.length) return "the execution does not name one rule per instruction";
      const constraints = policies[which].constraints;
      for (const [k, inner] of view.instructions.entries()) {
        const constraint = constraints[view.constraintIndices[k]!];
        if (!constraint) return "the execution names a rule the policy does not hold";
        const refusal = instructionRefusal(inner, constraint, request.facts);
        if (refusal) return `an instruction breaks the ${which} rule: ${refusal}`;
        /* A fresh key may sign only as the position this execution opens. */
        if (pool.kind === "dlmm" && head(inner.data, DISC.dlmmInitPosition2)) opened = inner.accounts[LAYOUT.dlmmInitPosition2.position] ?? null;
        if (pool.kind === "damm-v2" && head(inner.data, DISC.dammCreatePosition)) opened = inner.accounts[1] ?? null;
      }
      continue;
    }
    return "an instruction outside the care";
  }
  if (executions !== 1) return "not exactly one execution of the care";
  if (extraSigner && !(opened && opened.equals(extraSigner))) return "a second signer that is not the position being opened";
  return null;
}

export type CareSignatureRow = Readonly<{
  v: 1;
  cluster: string;
  role: "agent";
  mode: LaunchSignerMode;
  signer: string;
  keyRef: string | null;
  policy: string;
  action: "care.action";
  messageSha256: string;
  signature: string | null;
  outcome: "SIGNED" | "REFUSED";
  reason: string | null;
  at: string;
}>;

export type CareJournal = (row: CareSignatureRow) => Promise<void>;

export const NO_CARE_JOURNAL: CareJournal = async () => {
  throw new Error("no signing journal here");
};

export type CareSigner = Readonly<{
  publicKey: PublicKey;
  /** The agent's signature over the message, once the bounds allow it and the journal kept it; throws `CareSignerRefused` otherwise. */
  signMessage(message: Uint8Array, request: CareSignRequest): Promise<Uint8Array>;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function careSigner(key: KeySigner, options: Readonly<{ care: Care; journal: CareJournal; now?: () => Date }>): CareSigner {
  const { care } = options;
  const publicKey = care.terms.agent;
  const now = options.now ?? (() => new Date());
  const row = (fields: Pick<CareSignatureRow, "messageSha256" | "signature" | "outcome" | "reason" | "policy">): CareSignatureRow => ({
    v: 1,
    cluster: care.cluster,
    role: "agent",
    mode: key.mode,
    signer: publicKey.toBase58(),
    keyRef: key.keyRef,
    action: "care.action",
    ...fields,
    at: now().toISOString(),
  });
  return {
    publicKey,
    async signMessage(message, request) {
      const messageSha256 = sha256(message);
      const refusal = careRefusal(message, care, request);
      if (refusal) {
        await options.journal(row({ messageSha256, signature: null, outcome: "REFUSED", reason: refusal, policy: care.exitPolicy.toBase58() })).catch(() => undefined);
        throw new CareSignerRefused(refusal);
      }
      const signature = await key.sign(message);
      if (signature.length !== 64 || !ed25519Valid(message, signature, publicKey)) throw new CareSignerRefused("the key's signature does not verify against the agent's address");
      await options.journal(row({ messageSha256, signature: getBase58Decoder().decode(signature), outcome: "SIGNED", reason: null, policy: care.exitPolicy.toBase58() }));
      return signature;
    },
  };
}
