/**
 * CITY-203 — one action of the agent on a position it looks after, end to end: wrap the build in the care's policy,
 * read the accounts the rules look into, have the agent's signer judge and sign, send through our own RPC, read back.
 *
 * As the agent's trades (`../mandate/run.server.ts`): it never sends what its signer refused, never re-sends on its own,
 * and a transaction whose fate is unknown is read again, not sent again.
 */

import { type Connection, type TransactionInstruction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { AGENT_COMPUTE_UNIT_LIMIT, AGENT_HEAP_BYTES } from "../mandate/agent.ts";
import { MAX_TRANSACTION_BYTES, unsignedTransaction, wireSize } from "../mandate/human.ts";
import { readBack, readFacts } from "../mandate/run.server.ts";
import { refusalOf } from "../mandate/ssa.ts";
import { ComputeBudgetProgram } from "@solana/web3.js";
import type { Care } from "./enable.ts";
import { CareSignerRefused, type CareSigner } from "./signer.server.ts";
import { carePolicyExecuteInstruction, readCarePolicyExecute } from "./ssa-care.ts";
import type { CareBuild } from "./venue.server.ts";

export type CareOutcome =
  | Readonly<{ status: "refused-by-agent"; reason: string }>
  | Readonly<{ status: "refused-in-simulation"; reason: string }>
  | Readonly<{ status: "landed"; signature: string; ok: boolean; refusal: Readonly<{ code: string; reason: string }> | null; size: number }>
  | Readonly<{ status: "unknown"; signature: string; size: number }>;

/** The transaction's instructions, in order: compute budget, the agent's setup, the one execution under the policy. */
export function careInstructions(care: Care, build: CareBuild): readonly TransactionInstruction[] {
  const policy = build.policy === "exit" ? care.exitPolicy : care.tendPolicy;
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: AGENT_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.requestHeapFrame({ bytes: AGENT_HEAP_BYTES }),
    ...build.setup,
    carePolicyExecuteInstruction({ policy, signer: care.terms.agent, instructions: build.inner, constraintIndices: build.constraintIndices, accountIndex: care.vaultIndex, freshSigners: build.extraSigners.map((key) => key.publicKey) }),
  ];
}

export async function careAct(
  input: Readonly<{ connection: Connection; care: Care; signer: CareSigner; build: CareBuild; skipPreflight?: boolean }>,
): Promise<CareOutcome> {
  const { connection, care, build } = input;
  if (BigInt(Math.floor(Date.now() / 1000)) >= care.terms.expiresAt) return { status: "refused-by-agent", reason: "the care has ended" };
  const policy = build.policy === "exit" ? care.exitPolicy : care.tendPolicy;
  if (!(await connection.getAccountInfo(policy, "confirmed"))) return { status: "refused-by-agent", reason: "the care was stopped" };
  const instructions = careInstructions(care, build);
  const execution = instructions.at(-1)!;
  const view = readCarePolicyExecute({ programId: execution.programId, keys: execution.keys.map((key) => key.pubkey), data: execution.data });
  const facts = await readFacts(connection, view.instructions.flatMap((inner) => inner.accounts));
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = unsignedTransaction(care.terms.agent, instructions, blockhash, []);
  const size = wireSize(tx);
  if (size > MAX_TRANSACTION_BYTES) return { status: "refused-by-agent", reason: `the action is ${size} bytes, over the ${MAX_TRANSACTION_BYTES}-byte limit` };
  let signature: Uint8Array;
  try {
    signature = await input.signer.signMessage(tx.message.serialize(), { facts });
  } catch (error) {
    if (error instanceof CareSignerRefused) return { status: "refused-by-agent", reason: error.reason };
    throw error;
  }
  tx.addSignature(care.terms.agent, signature);
  if (build.extraSigners.length) tx.sign([...build.extraSigners]);
  const id = getBase58Decoder().decode(signature);
  try {
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: input.skipPreflight ?? false, maxRetries: 5 });
  } catch (error) {
    const logs = (error as { logs?: unknown }).logs;
    const refusal = Array.isArray(logs) ? refusalOf(logs.map(String)) : null;
    return { status: "refused-in-simulation", reason: refusal?.reason ?? (error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "refused") };
  }
  await connection.confirmTransaction({ signature: id, blockhash, lastValidBlockHeight }, "confirmed").catch(() => null);
  const read = await readBack(connection, id);
  if (!read) return { status: "unknown", signature: id, size };
  return { status: "landed", signature: id, ok: read.ok, refusal: read.ok ? null : refusalOf(read.logs), size };
}
