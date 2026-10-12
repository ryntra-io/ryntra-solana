/**
 * Pre-sign firewall for a provider-built swap transaction.
 *
 * The Send lane's byte discipline compares the wallet's returned bytes against a
 * message Ryntra built itself. A Jupiter order inverts the trust direction:
 * the unsigned bytes arrive FROM the provider, so before anything reaches the
 * signer's wallet this module decodes the wire, proves the fee payer is the
 * taker, requires the taker among the signers, enumerates every program the
 * message can invoke (program ids must be static account keys in a v0
 * message — lookup tables cannot smuggle one in), and fingerprints the exact
 * message bytes. The swap policy then judges the enumerated programs; this
 * module reports facts and refuses what it can read and knows to be unsafe.
 *
 * It is browser/server shared and contains no key or signing operation.
 */

import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./send-kinds.ts";

const MAX_WIRE_BYTES = 4_096;
/* The same two ids the kernel uses; the Token-2022 one used to be mistyped
   here too, which would have refused a correctly built Token-2022 swap after
   the wallet signed it. */
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);
const ALLOWED_SWAP_TOKEN_DISCRIMINANTS = new Set([1, 3, 12, 16, 17, 18, 21, 22]);
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/**
 * The Associated Token `Create` instruction carries no data; `CreateIdempotent`
 * carries a single `1`. Both are the same act, and both are safe for exactly
 * one reason: the program derives the account address from the wallet, the
 * token program and the mint, so an instruction whose payer AND wallet are
 * both the fee payer can only open an account that belongs to the fee payer.
 * The worst it can cost is rent, and that rent stays recoverable by its owner.
 */
const ATA_CREATE_DISCRIMINANTS = new Set([0, 1]);

type CompiledInstruction = Readonly<{
  programAddressIndex: number;
  accountIndices?: readonly number[];
  data?: Uint8Array;
}>;

type CompiledMessage = Readonly<{
  version: unknown;
  header: Readonly<{
    numSignerAccounts: number;
    numReadonlySignerAccounts: number;
    numReadonlyNonSignerAccounts: number;
  }>;
  staticAccounts: readonly string[];
  lifetimeToken: string;
  instructions: readonly CompiledInstruction[];
  addressTableLookups?: readonly Readonly<{
    lookupTableAddress: string;
    readonlyIndexes: readonly number[];
    writableIndexes: readonly number[];
  }>[];
}>;

export type SwapTransactionRefusal = Readonly<{
  ok: false;
  code:
    | "UNREADABLE"
    | "TOO_LARGE"
    | "VERSION_UNSUPPORTED"
    | "FEE_PAYER_MISMATCH"
    | "TAKER_NOT_SIGNER"
    | "NO_INSTRUCTIONS"
    | "DANGEROUS_TOKEN_INSTRUCTION"
    | "DANGEROUS_ACCOUNT_INSTRUCTION"
    | "PROGRAM_INDEX_OUT_OF_RANGE";
  reason: string;
}>;

export type SwapTransactionInspection = Readonly<{
  ok: true;
  /** sha256 over the exact message bytes — the review binds to this. */
  messageHashHex: string;
  version: 0;
  feePayer: string;
  /** Static signer addresses in message order; the taker is among them. */
  signerAddresses: readonly string[];
  /** Signature slots the provider already filled (JupiterZ market-maker legs). */
  providerPresignedCount: number;
  blockhash: string;
  /** Unique, sorted program ids the message can invoke at the top level. */
  programs: readonly string[];
  tokenProgramIndices: readonly number[];
  staticAccountCount: number;
  staticAccounts: readonly string[];
  lookupTables: readonly Readonly<{
    table: string;
    writableCount: number;
    readonlyCount: number;
  }>[];
  instructionCount: number;
  wireBytes: number;
  /** `account` is null when the address is resolved through a lookup table. */
  nativeWrapRoundTrip: Readonly<{
    accountIndex: number;
    account: string | null;
    fundedLamportsRaw: string;
    closesToTaker: true;
  }> | null;
  nativeWrapCandidate: Readonly<{
    accountIndex: number;
    account: string | null;
    fundedLamportsRaw: string;
  }> | null;
}>;

export type SwapTransactionCheck = SwapTransactionInspection | SwapTransactionRefusal;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer & Uint8Array);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    if (typeof Buffer !== "undefined") {
      const bytes = Buffer.from(value, "base64");
      /* Node silently tolerates malformed tails; re-encode to prove fidelity. */
      if (bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) return null;
      return new Uint8Array(bytes);
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export async function inspectJupiterSwapTransaction(args: {
  wireBase64: string;
  expectedTaker: string;
}): Promise<SwapTransactionCheck> {
  const wire = decodeBase64(args.wireBase64);
  if (!wire) {
    return { ok: false, code: "UNREADABLE", reason: "The provider transaction is not canonical base64." };
  }
  if (wire.byteLength > MAX_WIRE_BYTES) {
    return {
      ok: false,
      code: "TOO_LARGE",
      reason: `The provider transaction exceeds the ${MAX_WIRE_BYTES}-byte wire ceiling.`,
    };
  }

  let messageBytes: Uint8Array;
  let signatures: Readonly<Record<string, Uint8Array | null>>;
  let message: CompiledMessage;
  try {
    const decoded = getTransactionDecoder().decode(wire);
    messageBytes = decoded.messageBytes as unknown as Uint8Array;
    signatures = decoded.signatures as unknown as Readonly<Record<string, Uint8Array | null>>;
    message = getCompiledTransactionMessageDecoder().decode(messageBytes) as unknown as CompiledMessage;
  } catch {
    return {
      ok: false,
      code: "UNREADABLE",
      reason: "The provider transaction does not decode as a Solana wire transaction.",
    };
  }

  if (message.version !== 0) {
    return {
      ok: false,
      code: "VERSION_UNSUPPORTED",
      reason: `The swap path reviews v0 messages only; the provider sent version ${String(message.version)}.`,
    };
  }
  if (message.instructions.length === 0) {
    return { ok: false, code: "NO_INSTRUCTIONS", reason: "The provider transaction carries no instructions." };
  }

  const feePayer = message.staticAccounts[0] ?? "";
  if (feePayer !== args.expectedTaker) {
    return {
      ok: false,
      code: "FEE_PAYER_MISMATCH",
      reason: "The transaction's fee payer is not the taker wallet. M2 runs no gasless path; do not sign.",
    };
  }

  const signerAddresses = message.staticAccounts.slice(0, message.header.numSignerAccounts);
  if (!signerAddresses.includes(args.expectedTaker)) {
    return {
      ok: false,
      code: "TAKER_NOT_SIGNER",
      reason: "The taker wallet is not among the message's required signers.",
    };
  }

  const takerFundingFor = (accountIndex: number): CompiledInstruction | null =>
    message.instructions.find((instruction) => {
      const program = message.staticAccounts[instruction.programAddressIndex];
      const accounts = instruction.accountIndices ?? [];
      if (program !== SYSTEM_PROGRAM || accounts[0] !== 0 || accounts[1] !== accountIndex) return false;
      if (!instruction.data || instruction.data.length !== 12) return false;
      const view = new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength);
      return view.getUint32(0, true) === 2;
    }) ?? null;
  const lamportsOf = (instruction: CompiledInstruction | null): string =>
    instruction?.data
      ? new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength)
          .getBigUint64(4, true)
          .toString()
      : "0";

  /* Every account this message synchronizes as native wSOL, by index. */
  const syncedIndices = new Set<number>();
  for (const instruction of message.instructions) {
    const program = message.staticAccounts[instruction.programAddressIndex];
    if (!TOKEN_PROGRAMS.has(program ?? "") || instruction.data?.[0] !== 17) continue;
    const accountIndex = instruction.accountIndices?.[0];
    if (typeof accountIndex === "number") syncedIndices.add(accountIndex);
  }

  const closeInstructions = message.instructions.filter((instruction) => {
    const program = message.staticAccounts[instruction.programAddressIndex];
    return program !== undefined && TOKEN_PROGRAMS.has(program) && instruction.data?.[0] === 9;
  });
  let nativeWrapRoundTrip: SwapTransactionInspection["nativeWrapRoundTrip"] = null;
  if (closeInstructions.length > 1) {
    return {
      ok: false,
      code: "DANGEROUS_TOKEN_INSTRUCTION",
      reason: "The provider transaction closes more than one token account.",
    };
  }
  if (closeInstructions.length === 1) {
    const close = closeInstructions[0];
    const [sourceIndex, destinationIndex, authorityIndex] = close.accountIndices ?? [];
    const funding = sourceIndex === undefined ? null : takerFundingFor(sourceIndex);
    /*
     * A close is safe for exactly one reason, and it is not that the account
     * was opened here.
     *
     * `CloseAccount` names the account, the lamport destination and the
     * authority. The Token program refuses to run it unless the named
     * authority really is that account's owner or close authority — and the
     * authority named here is the fee payer, who signs. So a close whose
     * destination and authority are both the fee payer can only move lamports
     * INTO the signer's own balance. Nothing about it can cost them anything.
     *
     * Demanding that the account ALSO be created in this same transaction
     * added no safety and refused real orders: Jupiter reuses a wallet's
     * existing wSOL account when it has one and resolves it through an address
     * lookup table, so the account is neither opened here nor present among
     * the static keys. That requirement was the second wall in front of every
     * SOL swap, standing right behind the canary that hid it.
     *
     * `syncNative` stays mandatory whenever this transaction funded the
     * account: lamports moved in and never accounted for are exactly what the
     * sync exists to prevent. Buying native SOL funds nothing — the wSOL
     * arrives as the swap's own output — and needs no sync.
     */
    if (
      sourceIndex === undefined ||
      sourceIndex === 0 ||
      destinationIndex !== 0 ||
      authorityIndex !== 0 ||
      (funding !== null && !syncedIndices.has(sourceIndex))
    ) {
      return {
        ok: false,
        code: "DANGEROUS_TOKEN_INSTRUCTION",
        reason: "A token close does not return an account's lamports to the taker under the taker's own authority, or closes a funded account that was never synced.",
      };
    }
    nativeWrapRoundTrip = {
      accountIndex: sourceIndex,
      /* Null when the account is resolved through a lookup table. The effect
         firewall names it from the simulation's own account vector, which
         resolves every loaded address in order. */
      account: message.staticAccounts[sourceIndex] ?? null,
      fundedLamportsRaw: lamportsOf(funding),
      closesToTaker: true,
    };
  }
  /* An Associated Token create whose payer and wallet are both the fee payer
     opens an account that can belong to nobody else. Every account this
     message opens that way is collected once and reused by the checks below,
     so a durable destination account — what buying an asset you do not hold
     yet actually requires — is as reviewable as the temporary wSOL wrapper. */
  const createsTakerAccount = (instruction: CompiledInstruction): number | null => {
    const program = message.staticAccounts[instruction.programAddressIndex];
    if (program !== ASSOCIATED_TOKEN_PROGRAM) return null;
    const accounts = instruction.accountIndices ?? [];
    const discriminant = instruction.data && instruction.data.length > 0 ? instruction.data[0] : 0;
    if (!ATA_CREATE_DISCRIMINANTS.has(discriminant)) return null;
    if (accounts[0] !== 0 || accounts[2] !== 0 || typeof accounts[1] !== "number") return null;
    return accounts[1];
  };
  const takerCreatedIndices = new Set<number>();
  for (const instruction of message.instructions) {
    const created = createsTakerAccount(instruction);
    if (created !== null && created > 0) takerCreatedIndices.add(created);
  }
  const isTakerAccountIndex = (index: number | undefined): boolean =>
    typeof index === "number" && (index === nativeWrapRoundTrip?.accountIndex || takerCreatedIndices.has(index));

  /* wSOL synced into an account this transaction never closes back is the
     hazard the round trip exists to exclude: lamports wrapped and left
     somewhere. It is reported rather than refused here, and the effect
     firewall refuses it against the simulation's own account vector. */
  const strayCandidates = [...syncedIndices].filter((index) => index !== nativeWrapRoundTrip?.accountIndex);
  if (strayCandidates.length > 1) {
    return {
      ok: false,
      code: "DANGEROUS_ACCOUNT_INSTRUCTION",
      reason: "The provider transaction synchronizes more than one wSOL account it never closes.",
    };
  }
  const candidateIndex = strayCandidates[0] ?? null;
  const nativeWrapCandidate = candidateIndex === null
    ? null
    : {
        accountIndex: candidateIndex,
        account: message.staticAccounts[candidateIndex] ?? null,
        fundedLamportsRaw: lamportsOf(takerFundingFor(candidateIndex)),
      };

  const programs = new Set<string>();
  for (const instruction of message.instructions) {
    const program = message.staticAccounts[instruction.programAddressIndex];
    if (program === undefined) {
      return {
        ok: false,
        code: "PROGRAM_INDEX_OUT_OF_RANGE",
        reason: "An instruction names a program outside the static account keys.",
      };
    }
    if (
      TOKEN_PROGRAMS.has(program) &&
      instruction.data?.[0] !== 9 &&
      (!instruction.data ||
        instruction.data.length === 0 ||
        !ALLOWED_SWAP_TOKEN_DISCRIMINANTS.has(instruction.data[0]))
    ) {
      return {
        ok: false,
        code: "DANGEROUS_TOKEN_INSTRUCTION",
        reason: "The provider transaction contains a top-level token authority, delegate, mint, burn, freeze or unknown mutation.",
      };
    }
    if (TOKEN_PROGRAMS.has(program) && [1, 16, 17, 18, 22].includes(instruction.data?.[0] ?? -1)) {
      const accountIndex = instruction.accountIndices?.[0];
      if (!isTakerAccountIndex(accountIndex)) {
        return {
          ok: false,
          code: "DANGEROUS_TOKEN_INSTRUCTION",
          reason: "A Token initialize/sync instruction is not bound to an account this message opens for the taker.",
        };
      }
    }
    if (program === ASSOCIATED_TOKEN_PROGRAM && createsTakerAccount(instruction) === null) {
      return {
        ok: false,
        code: "DANGEROUS_ACCOUNT_INSTRUCTION",
        reason: "The Associated Token instruction is not a create whose payer and wallet are both the taker.",
      };
    }
    if (program === SYSTEM_PROGRAM) {
      const accounts = instruction.accountIndices ?? [];
      const data = instruction.data;
      const view = data?.length === 12 ? new DataView(data.buffer, data.byteOffset, data.byteLength) : null;
      const valid =
        view !== null &&
        accounts[0] === 0 &&
        isTakerAccountIndex(accounts[1]) &&
        view.getUint32(0, true) === 2 &&
        /* Only the wrap transfer is amount-bound, and only against its own
           account: a second System transfer funding a durable destination is
           a different, smaller row and must not be measured against the wrap. */
        (nativeWrapRoundTrip === null ||
          accounts[1] !== nativeWrapRoundTrip.accountIndex ||
          view.getBigUint64(4, true).toString() === nativeWrapRoundTrip.fundedLamportsRaw);
      if (!valid) {
        return {
          ok: false,
          code: "DANGEROUS_ACCOUNT_INSTRUCTION",
          reason: "The System instruction is not a taker-funded transfer into an account this message opens for the taker.",
        };
      }
    }
    programs.add(program);
  }

  let providerPresignedCount = 0;
  for (const [address, signature] of Object.entries(signatures)) {
    if (address === args.expectedTaker) continue;
    if (signature !== null && signature.some((byte) => byte !== 0)) providerPresignedCount += 1;
  }

  const lookupTables = (message.addressTableLookups ?? []).map((lookup) => ({
    table: lookup.lookupTableAddress,
    writableCount: lookup.writableIndexes.length,
    readonlyCount: lookup.readonlyIndexes.length,
  }));
  const tokenProgramIndices = message.staticAccounts
    .map((account, index) => (TOKEN_PROGRAMS.has(account) ? index : -1))
    .filter((index) => index >= 0);

  return {
    ok: true,
    messageHashHex: await sha256Hex(messageBytes),
    version: 0,
    feePayer,
    signerAddresses,
    providerPresignedCount,
    blockhash: message.lifetimeToken,
    programs: [...programs].sort(),
    tokenProgramIndices,
    staticAccountCount: message.staticAccounts.length,
    staticAccounts: [...message.staticAccounts],
    lookupTables,
    instructionCount: message.instructions.length,
    wireBytes: wire.byteLength,
    nativeWrapRoundTrip,
    nativeWrapCandidate,
  };
}
