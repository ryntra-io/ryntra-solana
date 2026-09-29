/**
 * What the wallet changed, in words.
 *
 * `BYTES_CHANGED` is a true and useless answer. It says the wallet returned a
 * different message than the one reviewed, which is exactly the condition that
 * must stop a submit — Jupiter's `/execute` accepts only the transaction its
 * own `/order` built, and answers `-3 invalid message bytes` for anything else
 * — but it tells the person nothing they can act on, and it tells us nothing
 * about which wallet did what.
 *
 * This module decodes both messages and names the difference: an added or
 * removed instruction, a rewritten compute-budget value, a different fee payer,
 * a moved blockhash. A wallet that quietly re-prices priority fees looks
 * identical to one that rewrote the route until somebody compares the two.
 *
 * It is browser/server shared, decides nothing, and holds no key. Its output is
 * evidence for a refusal that has already happened.
 */

import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

type CompiledInstruction = Readonly<{
  programAddressIndex: number;
  accountIndices?: readonly number[];
  data?: Uint8Array;
}>;

type CompiledMessage = Readonly<{
  version: unknown;
  header: Readonly<{ numSignerAccounts: number }>;
  staticAccounts: readonly string[];
  lifetimeToken: string;
  instructions: readonly CompiledInstruction[];
}>;

export type SwapMessageDifference = Readonly<{
  /** A short machine label, so a recurring wallet behaviour is countable. */
  kind:
    | "UNDECODABLE"
    | "FEE_PAYER"
    | "BLOCKHASH"
    | "INSTRUCTION_COUNT"
    | "COMPUTE_BUDGET"
    | "PROGRAM_SET"
    | "ACCOUNT_SET"
    | "INSTRUCTION_DATA"
    | "SIGNER_COUNT";
  /** One sentence a person can read without opening the transaction. */
  detail: string;
}>;

function decode(wireBase64: string): CompiledMessage | null {
  try {
    const binary =
      typeof Buffer !== "undefined"
        ? new Uint8Array(Buffer.from(wireBase64, "base64"))
        : Uint8Array.from(atob(wireBase64), (character) => character.charCodeAt(0));
    const transaction = getTransactionDecoder().decode(binary);
    return getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes as unknown as Uint8Array,
    ) as unknown as CompiledMessage;
  } catch {
    return null;
  }
}

/** The compute-budget values a wallet is most likely to rewrite, by name. */
function computeBudgetValues(message: CompiledMessage): readonly string[] {
  const values: string[] = [];
  for (const instruction of message.instructions) {
    if (message.staticAccounts[instruction.programAddressIndex] !== COMPUTE_BUDGET_PROGRAM) continue;
    const data = instruction.data;
    if (!data || data.length === 0) continue;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data[0] === 2 && data.length >= 5) {
      values.push(`unit limit ${view.getUint32(1, true)}`);
    } else if (data[0] === 3 && data.length >= 9) {
      values.push(`unit price ${view.getBigUint64(1, true).toString()} micro-lamports`);
    } else {
      values.push(`opcode ${data[0]}`);
    }
  }
  return values;
}

function programSet(message: CompiledMessage): readonly string[] {
  return [
    ...new Set(
      message.instructions
        .map((instruction) => message.staticAccounts[instruction.programAddressIndex])
        .filter((program): program is string => typeof program === "string"),
    ),
  ].sort();
}

/**
 * Compare the message a person reviewed against the one their wallet returned.
 *
 * Ordered so the first difference is the most explanatory: a wallet that
 * re-prices the transaction shows up as COMPUTE_BUDGET and nothing else, which
 * is a different story from one that added an instruction.
 */
export function describeSwapMessageChange(args: {
  reviewedWireBase64: string;
  returnedWireBase64: string;
}): readonly SwapMessageDifference[] {
  const reviewed = decode(args.reviewedWireBase64);
  const returned = decode(args.returnedWireBase64);
  if (!reviewed || !returned) {
    return [
      {
        kind: "UNDECODABLE",
        detail: !returned
          ? "The bytes the wallet returned do not decode as a Solana transaction at all."
          : "The reviewed bytes could no longer be decoded for comparison.",
      },
    ];
  }

  const differences: SwapMessageDifference[] = [];

  if (reviewed.staticAccounts[0] !== returned.staticAccounts[0]) {
    differences.push({
      kind: "FEE_PAYER",
      detail: `The fee payer changed from ${reviewed.staticAccounts[0] ?? "none"} to ${returned.staticAccounts[0] ?? "none"}.`,
    });
  }

  const reviewedBudget = computeBudgetValues(reviewed);
  const returnedBudget = computeBudgetValues(returned);
  if (reviewedBudget.join(" · ") !== returnedBudget.join(" · ")) {
    differences.push({
      kind: "COMPUTE_BUDGET",
      detail: `The wallet re-priced the transaction: ${reviewedBudget.join(", ") || "no compute budget"} became ${returnedBudget.join(", ") || "no compute budget"}. This is usually a wallet's own priority-fee setting.`,
    });
  }

  if (reviewed.instructions.length !== returned.instructions.length) {
    differences.push({
      kind: "INSTRUCTION_COUNT",
      detail: `The instruction count changed from ${reviewed.instructions.length} to ${returned.instructions.length}.`,
    });
  }

  const reviewedPrograms = programSet(reviewed);
  const returnedPrograms = programSet(returned);
  if (reviewedPrograms.join(",") !== returnedPrograms.join(",")) {
    const added = returnedPrograms.filter((program) => !reviewedPrograms.includes(program));
    const removed = reviewedPrograms.filter((program) => !returnedPrograms.includes(program));
    differences.push({
      kind: "PROGRAM_SET",
      detail: `The invoked programs changed${added.length > 0 ? `; added ${added.join(", ")}` : ""}${removed.length > 0 ? `; removed ${removed.join(", ")}` : ""}.`,
    });
  }

  if (reviewed.staticAccounts.length !== returned.staticAccounts.length) {
    differences.push({
      kind: "ACCOUNT_SET",
      detail: `The transaction's account list changed from ${reviewed.staticAccounts.length} to ${returned.staticAccounts.length} static accounts.`,
    });
  }

  if (reviewed.header.numSignerAccounts !== returned.header.numSignerAccounts) {
    differences.push({
      kind: "SIGNER_COUNT",
      detail: `The number of required signers changed from ${reviewed.header.numSignerAccounts} to ${returned.header.numSignerAccounts}.`,
    });
  }

  if (reviewed.lifetimeToken !== returned.lifetimeToken) {
    differences.push({
      kind: "BLOCKHASH",
      detail: "The wallet replaced the transaction's blockhash, so these are not the reviewed bytes.",
    });
  }

  /* Nothing structural moved and the hashes still differ: some instruction's
     own payload was rewritten. Name which one rather than leaving it at
     "different bytes". */
  if (differences.length === 0) {
    const changed = reviewed.instructions.findIndex((instruction, index) => {
      const other = returned.instructions[index];
      if (!other) return true;
      const left = instruction.data ?? new Uint8Array();
      const right = other.data ?? new Uint8Array();
      if (left.length !== right.length) return true;
      return left.some((byte, position) => byte !== right[position]);
    });
    differences.push({
      kind: "INSTRUCTION_DATA",
      detail:
        changed >= 0
          ? `Instruction ${changed + 1} of ${reviewed.instructions.length}, invoking ${reviewed.staticAccounts[reviewed.instructions[changed].programAddressIndex] ?? "an unknown program"}, carries different data than the one reviewed.`
          : "The messages differ in bytes this comparison cannot localise; treat them as unrelated transactions.",
    });
  }

  return differences;
}
