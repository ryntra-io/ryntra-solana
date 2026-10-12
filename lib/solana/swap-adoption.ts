/**
 * What to do when the wallet hands back a different transaction.
 *
 * Wallet Standard models browser wallets as transaction-MODIFYING signers, and
 * the one this product is used with does exactly that: it re-prices the
 * compute budget and attaches Lighthouse assertions before it signs.
 *
 * The Send path's comparator (`wallet-modification.ts`) proves a wallet's
 * reply is honest by matching every instruction account for account. That
 * works because Ryntra builds those transactions itself and they carry no
 * address lookup tables. A provider-built swap is almost entirely lookup
 * tables, and attaching a guard shifts every index in the message — the wallet
 * must rewrite the tables' own index lists to keep the same accounts resolving
 * to the same places. Compared byte for byte, that reads as
 * `LOOKUP_TABLES_CHANGED` on a transaction where nothing about the trade moved
 * at all, which is what refused every swap this product is actually used for.
 *
 * So the swap proves the same thing a different way, and a stronger one. The
 * structural checks here bound WHAT KIND of modification is tolerated: same
 * fee payer, same signers, same blockhash, same lookup tables by address, the
 * same sequence of business programs, and nothing added but a bounded compute
 * budget and recognised Lighthouse assertions — a program that can only read
 * and abort, never move value. What the transaction actually DOES to the
 * signer is then proved by re-simulating these exact bytes and reducing the
 * result to their own asset deltas, which the execute route does next and
 * which no index rewrite can talk its way past.
 *
 * It is browser/server shared, decides nothing on its own, and holds no key.
 */

import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

import { COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM } from "./wallet-modification.ts";

const MAX_COMPUTE_UNITS = 1_400_000;
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;

/**
 * The Lighthouse instruction variants a wallet may attach.
 *
 * `AssertAccountInfoMulti` and `AssertTokenAccountMulti`, the two a real
 * wallet was captured using. Both only read state and fail the transaction
 * when an assertion does not hold; neither can move anything. Any other
 * variant is refused rather than assumed harmless.
 */
const LIGHTHOUSE_ASSERTION_VARIANTS = new Set([6, 10]);

/**
 * The most a wallet may add to the network fee before this refuses.
 *
 * A swap competes for inclusion against everyone else trading the same pair,
 * so a wallet raising the priority fee under congestion is ordinary rather
 * than suspicious — but it is still the signer's money, so it is bounded. One
 * thousandth of a SOL is roughly ten cents at $100/SOL, well above the 75,000
 * lamports this wallet was captured requesting, and far below anything that
 * could matter beside the trade itself.
 */
export const MAX_SWAP_WALLET_PRIORITY_FEE_LAMPORTS = 1_000_000n;

export type SwapAdoptionRefusalCode =
  | "WALLET_MODIFIED_BYTES"
  | "WALLET_PRIORITY_FEE_TOO_HIGH"
  | "WALLET_BUDGET_UNREADABLE";

export type SwapAdoptionResult =
  | Readonly<{ ok: true; lane: "EXACT"; detail: string }>
  | Readonly<{
      ok: true;
      lane: "WALLET_GUARDS";
      detail: string;
      /** What the wallet's own compute budget can cost, in lamports. */
      priorityFeeLamports: string;
      addedPrograms: readonly string[];
    }>
  | Readonly<{ ok: false; code: SwapAdoptionRefusalCode; reason: string }>;

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
  addressTableLookups?: readonly Readonly<{ lookupTableAddress: string }>[];
}>;

function refuse(code: SwapAdoptionRefusalCode, reason: string): SwapAdoptionResult {
  return { ok: false, code, reason };
}

function decode(wireBase64: string): Readonly<{ message: CompiledMessage; bytes: Uint8Array }> | null {
  try {
    const binary =
      typeof Buffer !== "undefined"
        ? new Uint8Array(Buffer.from(wireBase64, "base64"))
        : Uint8Array.from(atob(wireBase64), (character) => character.charCodeAt(0));
    const transaction = getTransactionDecoder().decode(binary);
    const bytes = transaction.messageBytes as unknown as Uint8Array;
    return {
      message: getCompiledTransactionMessageDecoder().decode(bytes) as unknown as CompiledMessage,
      bytes,
    };
  } catch {
    return null;
  }
}

function programOf(message: CompiledMessage, instruction: CompiledInstruction): string {
  return String(message.staticAccounts[instruction.programAddressIndex] ?? "unknown");
}

const isGuard = (program: string) => program === COMPUTE_BUDGET_PROGRAM || program === LIGHTHOUSE_PROGRAM;

function lookupTables(message: CompiledMessage): readonly string[] {
  return (message.addressTableLookups ?? []).map((lookup) => String(lookup.lookupTableAddress));
}

/** The wallet's effective compute budget, or null when it cannot be priced. */
function computeBudget(
  instructions: readonly CompiledInstruction[],
): Readonly<{ unitLimit: number; microLamportsPerUnit: bigint; maximumPriorityFeeLamports: bigint }> | null {
  let unitLimit: number | null = null;
  let price: bigint | null = null;
  try {
    for (const instruction of instructions) {
      const data = instruction.data;
      if (!data || data.length === 0) return null;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (data[0] === 2 && data.length === 5 && unitLimit === null) {
        unitLimit = view.getUint32(1, true);
        if (unitLimit <= 0 || unitLimit > MAX_COMPUTE_UNITS) return null;
        continue;
      }
      if (data[0] === 3 && data.length === 9 && price === null) {
        price = view.getBigUint64(1, true);
        continue;
      }
      /* A ComputeBudget instruction this version does not recognise — or a
         duplicate of one it does — is not priced and therefore not adopted. */
      return null;
    }
  } catch {
    return null;
  }
  const limit = BigInt(unitLimit ?? MAX_COMPUTE_UNITS);
  const perUnit = price ?? 0n;
  return {
    unitLimit: unitLimit ?? MAX_COMPUTE_UNITS,
    microLamportsPerUnit: perUnit,
    maximumPriorityFeeLamports: (limit * perUnit + MICRO_LAMPORTS_PER_LAMPORT - 1n) / MICRO_LAMPORTS_PER_LAMPORT,
  };
}

function grouped(value: bigint | number): string {
  return value.toLocaleString("en-US");
}

/**
 * Decide the lane, or refuse.
 *
 * `EXACT` keeps the venue's managed execution, which is the better path when
 * it is available. `WALLET_GUARDS` is the narrow, recognised case. Anything
 * else is refused, and the caller names the difference separately so a person
 * sees what their wallet did rather than that it did something.
 */
export function assessSwapWalletAdoption(args: {
  reviewedWireBase64: string;
  signedWireBase64: string;
}): SwapAdoptionResult {
  const reviewed = decode(args.reviewedWireBase64);
  const signed = decode(args.signedWireBase64);
  if (!reviewed || !signed) {
    return refuse("WALLET_MODIFIED_BYTES", "The wallet's reply or the reviewed transaction could not be decoded.");
  }
  if (
    reviewed.bytes.length === signed.bytes.length &&
    reviewed.bytes.every((byte, index) => byte === signed.bytes[index])
  ) {
    return { ok: true, lane: "EXACT", detail: "The wallet signed the exact reviewed message bytes." };
  }

  const before = reviewed.message;
  const after = signed.message;

  if (before.version !== after.version) {
    return refuse("WALLET_MODIFIED_BYTES", "The wallet changed the transaction message version.");
  }
  if (before.lifetimeToken !== after.lifetimeToken) {
    return refuse(
      "WALLET_MODIFIED_BYTES",
      "The wallet replaced the transaction's blockhash, so these are not the reviewed bytes. Ask for a fresh order and sign that one.",
    );
  }
  if (String(before.staticAccounts[0]) !== String(after.staticAccounts[0])) {
    return refuse("WALLET_MODIFIED_BYTES", "The wallet changed which account pays for this transaction.");
  }

  const beforeSigners = before.staticAccounts.slice(0, before.header.numSignerAccounts).map(String);
  const afterSigners = after.staticAccounts.slice(0, after.header.numSignerAccounts).map(String);
  if (
    beforeSigners.length !== afterSigners.length ||
    beforeSigners.some((signer, index) => signer !== afterSigners[index])
  ) {
    return refuse("WALLET_MODIFIED_BYTES", "The wallet changed who has to sign this transaction.");
  }

  /* The tables themselves must be the same tables. Their index lists may be
     rewritten — attaching a guard shifts every index in the message, and the
     wallet has to keep the same accounts resolving to the same places. */
  const beforeTables = lookupTables(before);
  const afterTables = lookupTables(after);
  if (
    beforeTables.length !== afterTables.length ||
    beforeTables.some((table, index) => table !== afterTables[index])
  ) {
    return refuse("WALLET_MODIFIED_BYTES", "The wallet introduced or removed an address lookup table.");
  }

  /* Nothing new may be invoked except a compute budget and a guard. */
  const addedPrograms = [
    ...new Set(
      after.instructions
        .map((instruction) => programOf(after, instruction))
        .filter((program) => !before.instructions.some((entry) => programOf(before, entry) === program)),
    ),
  ];
  const unexpected = addedPrograms.filter((program) => !isGuard(program));
  if (unexpected.length > 0) {
    return refuse(
      "WALLET_MODIFIED_BYTES",
      `The wallet added a program this path does not accept: ${unexpected.join(", ")}.`,
    );
  }

  /*
   * The trade itself must be the same instructions, byte for byte.
   *
   * Programs and their DATA are compared; account indices deliberately are
   * not, because attaching a guard renumbers every one of them and that is the
   * whole reason this path exists. The data is where the route's own
   * minimum-out lives, so pinning it is what keeps the chain enforcing the
   * figure that was reviewed — a wallet free to rewrite it could pass a
   * simulation today and take a worse fill in the block. What the instructions
   * then DO to the signer is proved by re-simulating these exact bytes and
   * reducing them to the signer's own asset deltas.
   */
  const business = (message: CompiledMessage) =>
    message.instructions
      .filter((instruction) => !isGuard(programOf(message, instruction)))
      .map((instruction) => ({
        program: programOf(message, instruction),
        data: Array.from(instruction.data ?? []).join(","),
      }));
  const businessBefore = business(before);
  const businessAfter = business(after);
  if (
    businessBefore.length !== businessAfter.length ||
    businessBefore.some(
      (instruction, index) =>
        instruction.program !== businessAfter[index].program || instruction.data !== businessAfter[index].data,
    )
  ) {
    return refuse("WALLET_MODIFIED_BYTES", "The wallet changed what the trade itself does.");
  }

  /* A guard may only assert. Lighthouse variants that do anything else, or a
     variant this version does not recognise, are refused. */
  for (const instruction of after.instructions) {
    if (programOf(after, instruction) !== LIGHTHOUSE_PROGRAM) continue;
    const variant = instruction.data?.[0];
    if (variant === undefined || !LIGHTHOUSE_ASSERTION_VARIANTS.has(variant)) {
      return refuse(
        "WALLET_MODIFIED_BYTES",
        `The wallet attached a guard instruction this path does not recognise (variant ${variant ?? "none"}).`,
      );
    }
  }

  const budget = computeBudget(
    after.instructions.filter((instruction) => programOf(after, instruction) === COMPUTE_BUDGET_PROGRAM),
  );
  if (!budget) {
    return refuse(
      "WALLET_BUDGET_UNREADABLE",
      "The wallet's compute budget could not be priced, so its cost to you is unknown.",
    );
  }
  if (budget.maximumPriorityFeeLamports > MAX_SWAP_WALLET_PRIORITY_FEE_LAMPORTS) {
    return refuse(
      "WALLET_PRIORITY_FEE_TOO_HIGH",
      `Your wallet asks for up to ${grouped(budget.maximumPriorityFeeLamports)} lamports of priority fee, above the ${grouped(MAX_SWAP_WALLET_PRIORITY_FEE_LAMPORTS)} this path accepts. Lower the priority setting in the wallet and sign again.`,
    );
  }

  const guards = after.instructions.filter(
    (instruction) => programOf(after, instruction) === LIGHTHOUSE_PROGRAM,
  ).length;
  return {
    ok: true,
    lane: "WALLET_GUARDS",
    priorityFeeLamports: budget.maximumPriorityFeeLamports.toString(),
    addedPrograms,
    detail: `Your wallet kept the same trade, the same blockhash and the same signer, and set its own priority fee of at most ${grouped(budget.maximumPriorityFeeLamports)} lamports${guards > 0 ? ` plus ${guards} of its own safety checks` : ""}.`,
  };
}
