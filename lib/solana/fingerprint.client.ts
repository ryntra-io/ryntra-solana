/**
 * The operator's own check, run in the browser that asked for the signature.
 *
 * There are two questions about a wallet's reply and they belong in two
 * different places. "Is this a real signature by the sending account" is the
 * server's, because the server is what mints a receipt and must only attest to
 * what it verified itself. "Are these the bytes I approved" is the operator's,
 * and it has to run here — the fingerprint of what was built lives in this tab,
 * and shipping it somewhere to be compared would mean trusting the trip.
 *
 * Browser-safe by construction: Web Crypto's `digest`, no `node:crypto`, no
 * key material of any kind. It proves the bytes are unchanged; it deliberately
 * does not claim to prove the signature, and says so in its own verdict names.
 */

import { getBase58Decoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

import type { TransferPlan } from "./transaction.ts";
import { compareWalletTransaction } from "./wallet-modification.ts";

/** Fee and compute-limit instructions a wallet may inject on the way through. */
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

type CompiledMessage = {
  version: unknown;
  staticAccounts: readonly string[];
  lifetimeToken: string;
  instructions: readonly { programAddressIndex: number; accountIndices?: readonly number[]; data?: Uint8Array }[];
};

function decodeMessage(messageBytes: Uint8Array): CompiledMessage | null {
  try {
    return getCompiledTransactionMessageDecoder().decode(messageBytes) as unknown as CompiledMessage;
  } catch {
    return null;
  }
}

const programsOf = (message: CompiledMessage): string[] =>
  message.instructions.map((instruction) => message.staticAccounts[instruction.programAddressIndex] ?? "unknown");

type ResolvedInstruction = { program: string; accounts: string; data: string };

const hex = (bytes: Uint8Array | undefined): string =>
  [...(bytes ?? [])].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Instructions named by the addresses they actually touch, not by their index.
 *
 * A wallet that appends a program to the account table shifts nothing, but one
 * that inserts it renumbers every index after it — and an index-wise comparison
 * would then report "everything changed" for a transfer where nothing did. The
 * addresses are what the transfer means; the indices are how they were packed.
 */
function resolve(message: CompiledMessage): ResolvedInstruction[] {
  return message.instructions.map((instruction) => ({
    program: message.staticAccounts[instruction.programAddressIndex] ?? "unknown",
    accounts: (instruction.accountIndices ?? []).map((index) => message.staticAccounts[index] ?? "unknown").join(","),
    data: hex(instruction.data),
  }));
}

/**
 * What a ComputeBudget instruction actually asks for, in the units it is
 * denominated in. Stating "a priority fee" without the number would be the same
 * shape of uselessness this whole check exists to remove.
 */
function describeComputeBudget(data: Uint8Array | undefined): string | null {
  if (!data || data.length === 0) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  /* Grouped the same way `scaleRawAmount` groups, and deliberately not with
     `toLocaleString`: that renders `1 000` on one machine and `1,000` on
     another, and a number on a money surface must not depend on where the
     browser thinks it is. Caught by a test that read the machine's own output
     rather than the one assumed. */
  const grouped = (value: number | bigint) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  try {
    if (data[0] === 2 && data.length >= 5) return `a compute-unit limit of ${grouped(view.getUint32(1, true))}`;
    if (data[0] === 3 && data.length >= 9)
      return `a priority fee of ${grouped(view.getBigUint64(1, true))} microLamports per compute unit`;
  } catch {
    return null;
  }
  return null;
}

/**
 * What actually changed between the transaction this tab built and the one the
 * wallet handed back.
 *
 * "A different transaction" is true and useless: it leaves the operator with a
 * dead end and no idea whether the wallet added a priority fee, refreshed a
 * stale blockhash, or rewrote where the money goes — three findings with three
 * completely different responses. The bytes are right here and they decode, so
 * the refusal says which one it is.
 *
 * The added-instruction case is called out by name because it is the common
 * one: several wallets inject a ComputeBudget fee instruction by default, and
 * an operator who is told that can switch it off, while an operator told "a
 * different transaction" cannot do anything at all.
 */
function classifyDifference(
  expectedWireBase64: string,
  actualWireBase64: string,
  actualMessageBytes: Uint8Array,
  expectsTokenGuard: boolean,
): { feeOnly: boolean; detail: string } {
  const refuse = (detail: string) => ({ feeOnly: false, detail });

  /* Wallet Standard explicitly permits transaction-modifying signers. The
     shared browser/server comparison is the authority for the compatible
     case, including Phantom's canonical ComputeBudget + Lighthouse pair. It
     names the exact fee ceiling and proves the business instructions did not
     move. The older field-by-field diagnostics remain below as a fallback for
     malformed replies that the shared decoder cannot classify. */
  const shared = compareWalletTransaction({
    expectedWireBase64,
    actualWireBase64,
    expectsTokenGuard,
  });
  if (shared.verdict === "WALLET_GUARDS_ONLY") {
    return { feeOnly: true, detail: shared.detail };
  }
  if (shared.verdict === "CHANGED") return refuse(shared.detail);

  const expectedTransaction = (() => {
    try {
      return getTransactionDecoder().decode(fromBase64(expectedWireBase64));
    } catch {
      return null;
    }
  })();
  const expected = expectedTransaction ? decodeMessage(expectedTransaction.messageBytes as unknown as Uint8Array) : null;
  const actual = decodeMessage(actualMessageBytes);
  if (!expected || !actual) return refuse("The two transactions could not be compared field by field.");

  /* The fee-only test, and it is a test rather than an assumption: strip the
     instructions the wallet added, and what is left must be byte-identical to
     what was built — same programs, same accounts in the same order, same
     instruction data, same blockhash, same fee payer, no new signer. Anything
     that survives that filter is a change to the transfer itself. */
  const expectedResolved = resolve(expected);
  const actualResolved = resolve(actual);
  const addedFee = actual.instructions.filter(
    (instruction) => actual.staticAccounts[instruction.programAddressIndex] === COMPUTE_BUDGET_PROGRAM,
  );
  const withoutFee = actualResolved.filter((instruction) => instruction.program !== COMPUTE_BUDGET_PROGRAM);
  const remainderMatches =
    withoutFee.length === expectedResolved.length &&
    withoutFee.every(
      (instruction, index) =>
        instruction.program === expectedResolved[index]?.program &&
        instruction.accounts === expectedResolved[index]?.accounts &&
        instruction.data === expectedResolved[index]?.data,
    );

  if (
    addedFee.length > 0 &&
    remainderMatches &&
    expected.lifetimeToken === actual.lifetimeToken &&
    expected.staticAccounts[0] === actual.staticAccounts[0] &&
    expectedResolved.every((instruction) => instruction.program !== COMPUTE_BUDGET_PROGRAM)
  ) {
    const asked = addedFee
      .map((instruction) => describeComputeBudget(instruction.data))
      .filter((entry): entry is string => entry !== null);
    return {
      feeOnly: true,
      detail: `Your wallet added ${asked.length > 0 ? asked.join(" and ") : "a ComputeBudget instruction"} of its own. Every other byte is the one built here — same recipient, same mint, same amount, same blockhash — so nothing about what moves has changed. What you pay in network fees did.`,
    };
  }

  const before = programsOf(expected);
  const after = programsOf(actual);
  const added = after.filter((program) => !before.includes(program));
  if (added.length > 0) {
    return refuse(
      added.includes(COMPUTE_BUDGET_PROGRAM)
        ? `The wallet added a ComputeBudget instruction **and** changed something else. A fee instruction on its own is accepted here; this is not that, so it is refused.`
        : `The wallet added ${added.length} instruction${added.length === 1 ? "" : "s"} nothing here asked for: ${added.join(", ")}.`,
    );
  }
  if (after.length !== before.length) {
    return refuse(
      `This tab built ${before.length} instruction${before.length === 1 ? "" : "s"} and the wallet returned ${after.length}.`,
    );
  }
  if (expected.lifetimeToken !== actual.lifetimeToken) {
    return refuse(
      "The wallet replaced the blockhash. Nothing about the transfer changed, but these are not the bytes that were reviewed — build again and sign without waiting.",
    );
  }

  const movedAccount = expected.staticAccounts.findIndex((account, index) => actual.staticAccounts[index] !== account);
  if (movedAccount >= 0 || expected.staticAccounts.length !== actual.staticAccounts.length) {
    return refuse(
      `The account list differs — position ${Math.max(movedAccount, 0)} was ${expected.staticAccounts[movedAccount] ?? "absent"} and came back ${actual.staticAccounts[movedAccount] ?? "absent"}. This is the difference that can change where value goes; do not approve it.`,
    );
  }

  const changed = expectedResolved.findIndex((instruction, index) => instruction.data !== actualResolved[index]?.data);
  if (changed >= 0) {
    return refuse(
      `Instruction ${changed} carries different data — same program, different arguments. This is the difference that can change an amount; do not approve it.`,
    );
  }
  return refuse("The transaction differs in its header or version, though every instruction and account matched.");
}

/**
 * `BYTES_FEE_ADDED` is a deliberate third answer, and it is a relaxation of the
 * original two — recorded here rather than buried, because it is the only place
 * this product accepts bytes that are not the exact bytes it built.
 *
 * Every current Solana wallet may attach its own ComputeBudget instruction, so
 * refusing that categorically is not a strict gate — it is a surface no honest
 * wallet can complete, which would make the signed lifecycle unreachable rather
 * than safe. The guarantee that is kept is the one that matters: the fee
 * instruction is *removed* and the remainder must be byte-identical to what was
 * built, so the recipient, the mint, the amount, the account order, the fee
 * payer and the blockhash are all still exactly what was reviewed. What is
 * given up is only this: the sender may pay more in network fees than the
 * screen quoted, and the screen says so in the numbers the wallet asked for.
 */
export const BYTES_CHECK_VERDICTS = [
  "BYTES_MATCH",
  "BYTES_FEE_ADDED",
  "BYTES_CHANGED",
  "NOT_SIGNED",
  "UNREADABLE",
] as const;
export type BytesCheckVerdict = (typeof BYTES_CHECK_VERDICTS)[number];

export type BytesCheck = Readonly<{
  verdict: BytesCheckVerdict;
  expectedMessageHash: string;
  actualMessageHash: string | null;
  signerPresent: boolean;
  /**
   * The sending account's signature, base58 — present exactly when
   * `signerPresent` is true.
   *
   * Reported here because this function is the only place in the browser that
   * decodes the wallet's reply, and because of what it cost not to have it.
   * The signature used to become knowable to this tab only when `../settle`
   * answered, so a reload between the wallet approving and that answer left a
   * live mainnet transfer with nothing anywhere able to name it. Reading it
   * from bytes already decoded adds no parsing and no trust: it is what the
   * wallet returned, and the server verifies it again before any receipt.
   */
  signature: string | null;
  detail: string;
}>;

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Compare what the wallet returned against what this tab built. Never throws.
 *
 * A hash match means every field of every instruction matched, because the
 * hash is over the bytes those fields compile to — which is why this is one
 * comparison rather than a checklist that could forget an entry.
 */
export async function checkReturnedBytes(args: {
  plan: TransferPlan;
  signedWireBase64: string;
}): Promise<BytesCheck> {
  const expected = args.plan.fingerprint.messageHash;

  let messageBytes: Uint8Array;
  let signatures: Record<string, Uint8Array | null>;
  try {
    const decoded = getTransactionDecoder().decode(fromBase64(args.signedWireBase64));
    messageBytes = decoded.messageBytes as unknown as Uint8Array;
    signatures = decoded.signatures as unknown as Record<string, Uint8Array | null>;
  } catch {
    return {
      verdict: "UNREADABLE",
      expectedMessageHash: expected,
      actualMessageHash: null,
      signerPresent: false,
      signature: null,
      detail: "The wallet's reply did not decode as a Solana transaction. Nothing is submitted.",
    };
  }

  const actual = await sha256Hex(messageBytes);
  const raw = signatures[args.plan.fingerprint.feePayer] ?? null;
  /* An all-zero slot is how an unsigned transaction encodes a signature that
     is not there; treating it as present would report a cancelled wallet as a
     signed one. */
  const signerPresent = raw !== null && raw.some((byte) => byte !== 0);
  /* The library's own decoder, not a second base58 implementation. */
  const signature = signerPresent && raw ? getBase58Decoder().decode(raw) : null;

  if (actual !== expected) {
    const difference = classifyDifference(
      args.plan.unsignedWireBase64,
      args.signedWireBase64,
      messageBytes,
      args.plan.actionKind !== "NATIVE_SOL",
    );
    if (difference.feeOnly && signerPresent) {
      return {
        verdict: "BYTES_FEE_ADDED",
        expectedMessageHash: expected,
        actualMessageHash: actual,
        signerPresent,
        signature,
        detail: difference.detail,
      };
    }
    return {
      verdict: "BYTES_CHANGED",
      expectedMessageHash: expected,
      actualMessageHash: actual,
      signerPresent,
      signature,
      detail: `The wallet returned a different transaction from the one built here, and nothing is submitted. ${difference.detail}`,
    };
  }
  if (!signerPresent) {
    return {
      verdict: "NOT_SIGNED",
      expectedMessageHash: expected,
      actualMessageHash: actual,
      signerPresent: false,
      signature: null,
      detail:
        "The transaction came back unchanged but unsigned. The wallet was most likely cancelled, or it has a different account selected.",
    };
  }
  return {
    verdict: "BYTES_MATCH",
    expectedMessageHash: expected,
    actualMessageHash: actual,
    signerPresent: true,
    signature,
    detail:
      "These are the exact message bytes in the current Review, and a signature is present for the sending account. Whether that signature verifies is checked again on the server, which is what the receipt rests on.",
  };
}
