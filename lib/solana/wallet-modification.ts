/**
 * Compare a Wallet Standard signer's returned transaction with the message
 * that entered the wallet.
 *
 * Wallet Standard deliberately models browser wallets as transaction-
 * modifying signers: a wallet may recompile the message and add guard or
 * priority-fee instructions before it signs. Byte equality therefore remains
 * the strongest answer, but it cannot be the only honest answer. This module
 * names one narrow compatible case — recognised ComputeBudget instructions —
 * and proves that every business instruction, account role, signer and the
 * blockhash stayed the same.
 *
 * It is browser/server shared and contains no key or signing operation.
 */

import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";

export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
/** Canonical Lighthouse Protocol program id declared by its open-source program. */
export const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
/** The last value of Lighthouse's own `LogLevel` (0 `Silent` … 6 `FailedEncodedNoop`,
    `lighthouse-sdk` 2.1.0). The level only chooses what is logged when an
    assertion fails; Phantom signs at 4, the Seeker Wallet at 5. */
const LIGHTHOUSE_MAX_LOG_LEVEL = 6;
const MAX_COMPUTE_UNITS = 1_400_000;
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;

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
  addressTableLookups?: unknown;
}>;

export type WalletModificationReason =
  | "EXACT"
  | "UNREADABLE"
  | "VERSION_CHANGED"
  | "BLOCKHASH_CHANGED"
  | "LOOKUP_TABLES_CHANGED"
  | "SIGNERS_CHANGED"
  | "ACCOUNT_ROLE_CHANGED"
  | "INSTRUCTION_CHANGED"
  | "PROGRAM_ADDED"
  | "COMPUTE_BUDGET_INVALID"
  | "WALLET_GUARD_INVALID";

type ComputeBudgetSummary = Readonly<{
  unitLimit: number;
  microLamportsPerUnit: string;
  maximumPriorityFeeLamports: string;
}>;

export type WalletTransactionComparison = Readonly<{
  verdict: "EXACT" | "WALLET_GUARDS_ONLY" | "CHANGED" | "UNREADABLE";
  reasonCode: WalletModificationReason;
  detail: string;
  addedPrograms: readonly string[];
  computeBudget: ComputeBudgetSummary | null;
  lighthouseAssertions: readonly Readonly<{
    kind: "ASSERT_ACCOUNT_INFO_MULTI" | "ASSERT_TOKEN_ACCOUNT_MULTI";
    account: string;
  }>[];
}>;

type ResolvedInstruction = Readonly<{
  program: string;
  accounts: readonly string[];
  data: string;
}>;

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function hex(bytes: Uint8Array | undefined): string {
  return [...(bytes ?? [])].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function grouped(value: number | bigint | string): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function decode(wireBase64: string): Readonly<{ message: CompiledMessage; messageBytes: Uint8Array }> | null {
  try {
    const transaction = getTransactionDecoder().decode(fromBase64(wireBase64));
    const messageBytes = transaction.messageBytes as unknown as Uint8Array;
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes) as unknown as CompiledMessage;
    return { message, messageBytes };
  } catch {
    return null;
  }
}

/**
 * Name one account of an instruction, by address where the message carries it.
 *
 * An index past the static keys belongs to an address lookup table, and the
 * message does not carry that address. Reading every one of them as the same
 * `"unknown"` made two DIFFERENT lookup accounts compare equal — harmless for
 * a Send, which uses no lookup tables, and unsound for a swap, whose route
 * accounts live almost entirely in them.
 *
 * The lookups themselves are asserted byte-identical before any instruction is
 * compared, so an index past the static keys denotes the same table and the
 * same position in both messages. That position IS a stable identity, and it
 * is what gets compared. A wallet that added accounts shifts every index; both
 * sides are resolved against their own message, so the identity survives the
 * shift while a substituted account does not.
 */
function accountIdentity(message: CompiledMessage, index: number): string {
  const known = message.staticAccounts[index];
  if (known !== undefined) return String(known);
  return `lookup:${index - message.staticAccounts.length}`;
}

type MessageLookup = Readonly<{ lookupTableAddress: string; writableIndexes: readonly number[]; readonlyIndexes: readonly number[] }>;

function messageLookups(message: CompiledMessage): readonly MessageLookup[] {
  const raw = (message as { addressTableLookups?: unknown }).addressTableLookups;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      lookupTableAddress: String(row.lookupTableAddress ?? row.accountKey ?? ""),
      writableIndexes: Array.from((row.writableIndexes ?? []) as ArrayLike<number>),
      readonlyIndexes: Array.from((row.readonlyIndexes ?? []) as ArrayLike<number>),
    };
  });
}

/** One account of a message: the address it names and what it may do. */
export type ExpandedAccount = Readonly<{ address: string; role: string }>;

/**
 * Every account a message names, in index order, with its role.
 *
 * A v0 message orders accounts: the static keys, then every writable key the
 * lookup tables contribute, then every readonly one. Given the tables' contents
 * this turns an index into the address it stands for — and an address is the
 * thing that decides where money goes. A position is not.
 *
 * `null` when any table is missing or an index falls outside it. The caller
 * treats that as "cannot resolve" and falls back to the stricter comparison,
 * which is the safe direction.
 */
export function expandAccounts(
  message: CompiledMessage,
  tables: Readonly<Record<string, readonly string[]>>,
): readonly ExpandedAccount[] | null {
  const out: ExpandedAccount[] = message.staticAccounts.map((account, index) => ({
    address: String(account),
    role: accountRole(message, index),
  }));
  const lookups = messageLookups(message);
  for (const kind of ["writableIndexes", "readonlyIndexes"] as const) {
    for (const lookup of lookups) {
      const table = tables[lookup.lookupTableAddress];
      if (!table) return null;
      for (const index of lookup[kind]) {
        const address = table[index];
        if (address === undefined) return null;
        out.push({ address, role: kind === "writableIndexes" ? "NON_SIGNER:WRITABLE" : "NON_SIGNER:READONLY" });
      }
    }
  }
  return out;
}

/** The lookup tables a wire transaction reads, so a caller can fetch them. */
export function lookupTableAddressesOf(wireBase64: string): readonly string[] {
  const decoded = decode(wireBase64);
  if (!decoded) return [];
  return messageLookups(decoded.message)
    .map((lookup) => lookup.lookupTableAddress)
    .filter(Boolean);
}

function resolve(
  message: CompiledMessage,
  instruction: CompiledInstruction,
  expanded: readonly ExpandedAccount[] | null = null,
): ResolvedInstruction {
  if (expanded) {
    return {
      program: expanded[instruction.programAddressIndex]?.address ?? "unknown",
      accounts: (instruction.accountIndices ?? []).map((index) => expanded[index]?.address ?? `unresolved:${index}`),
      data: hex(instruction.data),
    };
  }
  return resolveByPosition(message, instruction);
}

function resolveByPosition(message: CompiledMessage, instruction: CompiledInstruction): ResolvedInstruction {
  return {
    program: String(message.staticAccounts[instruction.programAddressIndex] ?? "unknown"),
    accounts: (instruction.accountIndices ?? []).map((index) => accountIdentity(message, index)),
    data: hex(instruction.data),
  };
}

function instructionEqual(left: ResolvedInstruction, right: ResolvedInstruction): boolean {
  return (
    left.program === right.program &&
    left.data === right.data &&
    left.accounts.length === right.accounts.length &&
    left.accounts.every((account, index) => account === right.accounts[index])
  );
}

function accountRole(message: CompiledMessage, index: number): string {
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  const signer = index < numSignerAccounts;
  const writable = signer
    ? index < numSignerAccounts - numReadonlySignerAccounts
    : index < message.staticAccounts.length - numReadonlyNonSignerAccounts;
  return `${signer ? "SIGNER" : "NON_SIGNER"}:${writable ? "WRITABLE" : "READONLY"}`;
}

function addressTableLookups(message: CompiledMessage): string {
  if (!("addressTableLookups" in message)) return "[]";
  return JSON.stringify(message.addressTableLookups ?? []);
}

function changed(reasonCode: WalletModificationReason, detail: string, addedPrograms: readonly string[] = []): WalletTransactionComparison {
  return { verdict: "CHANGED", reasonCode, detail, addedPrograms, computeBudget: null, lighthouseAssertions: [] };
}

function computeBudget(instructions: readonly CompiledInstruction[]): ComputeBudgetSummary | "INVALID" {
  let unitLimit: number | null = null;
  let microLamportsPerUnit: bigint | null = null;
  try {
    for (const instruction of instructions) {
      if ((instruction.accountIndices?.length ?? 0) !== 0 || !instruction.data) return "INVALID";
      const data = instruction.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (data[0] === 2 && data.length === 5 && unitLimit === null) {
        unitLimit = view.getUint32(1, true);
        if (unitLimit <= 0 || unitLimit > MAX_COMPUTE_UNITS) return "INVALID";
        continue;
      }
      if (data[0] === 3 && data.length === 9 && microLamportsPerUnit === null) {
        microLamportsPerUnit = view.getBigUint64(1, true);
        continue;
      }
      return "INVALID";
    }
  } catch {
    return "INVALID";
  }
  const pricedLimit = BigInt(unitLimit ?? MAX_COMPUTE_UNITS);
  const price = microLamportsPerUnit ?? 0n;
  return {
    unitLimit: unitLimit ?? MAX_COMPUTE_UNITS,
    microLamportsPerUnit: price.toString(),
    maximumPriorityFeeLamports: ((pricedLimit * price + MICRO_LAMPORTS_PER_LAMPORT - 1n) / MICRO_LAMPORTS_PER_LAMPORT).toString(),
  };
}

/**
 * Compare two complete wire transactions. Signature slots are intentionally
 * ignored; the server verifies the actual Ed25519 signature separately.
 */
export function compareWalletTransaction(args: {
  expectedWireBase64: string;
  actualWireBase64: string;
  /**
   * Whether this transfer has a token account for a wallet guard to assert on.
   *
   * Phantom writes one Lighthouse assertion per thing it can check. A token
   * transfer gets two — the fee payer's account info and the destination token
   * account — and a native SOL transfer gets only the first, because there is
   * no token account in the message at all. Requiring the pair unconditionally
   * was right for the one M1B case it was written against and rejected every
   * signed SOL transfer as "guard pair is incomplete", after the person had
   * already approved it. Defaults to true so an omitted argument stays as
   * strict as before.
   */
  expectsTokenGuard?: boolean;
  /**
   * How strictly the wallet's own Lighthouse assertions are shaped.
   *
   * `SEND_PAIR` — the default and what Send has always required: exactly the
   * account-info assertion on the fee payer plus, where a token account exists,
   * the token assertion on it. Correct for a transfer, which changes two
   * balances.
   *
   * `BOUNDED` — for a transaction that changes more than two: a CCTP burn moves
   * the owner's lamports, its token balance, and creates and funds a brand-new
   * message account that is itself a signer. Phantom writes one assertion per
   * thing it can check, so the Send-shaped pair rejects an honest signature on
   * a burn — which is exactly what it did.
   *
   * What `BOUNDED` still requires is everything that matters: only the two
   * known assertion kinds, bounded length and log level, guards strictly after
   * the business instructions, a cap on how many there may be, and every
   * asserted account already named in the reviewed message. What it drops is
   * the count and the role of the targets. That is safe in a way worth stating:
   * a Lighthouse assertion can only make a transaction *fail*. It moves
   * nothing, and the business instructions have already been compared byte for
   * byte and are re-simulated before the burn.
   */
  guardPolicy?: "SEND_PAIR" | "BOUNDED";
  /**
   * The address lookup tables both messages read, by table address.
   *
   * Without them this module can only compare a lookup account by its
   * *position*, which forces it to demand that the packed lookup entries stay
   * byte-identical — and a wallet that recompiles the message repacks them,
   * inlines them into the static keys, or reorders them, all without touching a
   * single account the transaction actually uses. Relay's Solana deposit is such
   * a message: two static keys and three accounts behind one table. Every honest
   * signature of it came back `LOOKUP_TABLES_CHANGED`.
   *
   * Given the tables, both sides are expanded to real addresses and compared as
   * addresses. That is strictly stronger than the positional test it replaces:
   * a substituted account is caught by name rather than by where it sat. When a
   * table cannot be read the comparison falls back to the byte-identical
   * demand, which refuses rather than guesses.
   */
  lookupTables?: Readonly<Record<string, readonly string[]>>;
}): WalletTransactionComparison {
  const expected = decode(args.expectedWireBase64);
  const actual = decode(args.actualWireBase64);
  if (!expected || !actual) {
    return {
      verdict: "UNREADABLE",
      reasonCode: "UNREADABLE",
      detail: "The wallet reply or the reviewed transaction could not be decoded.",
      addedPrograms: [],
      computeBudget: null,
      lighthouseAssertions: [],
    };
  }
  if (bytesEqual(expected.messageBytes, actual.messageBytes)) {
    return {
      verdict: "EXACT",
      reasonCode: "EXACT",
      detail: "The wallet signed the exact reviewed message bytes.",
      addedPrograms: [],
      computeBudget: null,
      lighthouseAssertions: [],
    };
  }

  const before = expected.message;
  const after = actual.message;
  if (before.version !== after.version) {
    return changed("VERSION_CHANGED", "The wallet changed the transaction message version.");
  }
  if (before.lifetimeToken !== after.lifetimeToken) {
    return changed(
      "BLOCKHASH_CHANGED",
      "Nothing about the transfer changed, but the wallet replaced the blockhash from Review. Build a fresh Review and sign it without waiting.",
    );
  }
  /* Resolve both sides to real addresses where the tables are available. When
     that succeeds, packing is no longer evidence of anything and is not asked
     about; when it does not, the byte-identical demand stands. */
  const tables = args.lookupTables ?? {};
  const expandedBefore = expandAccounts(before, tables);
  const expandedAfter = expandAccounts(after, tables);
  const byAddress = expandedBefore !== null && expandedAfter !== null;

  if (!byAddress && addressTableLookups(before) !== addressTableLookups(after)) {
    return changed("LOOKUP_TABLES_CHANGED", "The wallet changed the address lookup tables.");
  }

  const expectedSigners = before.staticAccounts.slice(0, before.header.numSignerAccounts).map(String);
  const actualSigners = after.staticAccounts.slice(0, after.header.numSignerAccounts).map(String);
  if (
    expectedSigners.length !== actualSigners.length ||
    expectedSigners.some((signer, index) => signer !== actualSigners[index])
  ) {
    return changed("SIGNERS_CHANGED", "The wallet changed the fee payer or required signer set.");
  }

  if (byAddress) {
    /* Every account the Review named must still be there, doing the same thing.
       Compared by address, so moving one out of a table and into the static keys
       — which is how wallets recompile — is not a change, and swapping one for
       another still is. */
    const roleAfter = new Map(expandedAfter.map((entry) => [entry.address, entry.role]));
    for (const entry of expandedBefore) {
      const now = roleAfter.get(entry.address);
      if (now === undefined) return changed("ACCOUNT_ROLE_CHANGED", `The wallet dropped account ${entry.address}.`);
      if (now !== entry.role) return changed("ACCOUNT_ROLE_CHANGED", `The wallet changed the role of account ${entry.address}.`);
    }
  } else {
    for (const expectedAccount of before.staticAccounts.map(String)) {
      const beforeIndex = before.staticAccounts.findIndex((account) => String(account) === expectedAccount);
      const afterIndex = after.staticAccounts.findIndex((account) => String(account) === expectedAccount);
      if (afterIndex < 0 || accountRole(before, beforeIndex) !== accountRole(after, afterIndex)) {
        return changed("ACCOUNT_ROLE_CHANGED", `The wallet changed the role of account ${expectedAccount}.`);
      }
    }
  }

  const expectedResolved = before.instructions.map((instruction) => resolve(before, instruction, expandedBefore));
  const afterResolved = after.instructions.map((instruction) => resolve(after, instruction, expandedAfter));
  const computeInstructions = after.instructions.filter(
    (instruction) => String(after.staticAccounts[instruction.programAddressIndex]) === COMPUTE_BUDGET_PROGRAM,
  );
  const lighthouseInstructions = after.instructions.filter(
    (instruction) => String(after.staticAccounts[instruction.programAddressIndex]) === LIGHTHOUSE_PROGRAM,
  );
  /*
   * Compare what the transaction DOES, on both sides.
   *
   * The guard programs were filtered out of the wallet's reply and compared
   * against the whole reviewed message — correct while the only transactions
   * reaching here were ones Ryntra built itself, which carry no compute budget
   * at all. A provider-built swap always carries one, so the reviewed side had
   * two instructions the wallet's side had been stripped of, and every such
   * transaction came back INSTRUCTION_CHANGED however honest the wallet was.
   * Both sides are reduced to their business instructions; the budget is
   * accounted for separately, below, where it is priced and capped.
   */
  const isGuardProgram = (program: string) =>
    program === COMPUTE_BUDGET_PROGRAM || program === LIGHTHOUSE_PROGRAM;
  const businessBefore = expectedResolved.filter((instruction) => !isGuardProgram(instruction.program));
  const businessAfter = afterResolved.filter((instruction) => !isGuardProgram(instruction.program));
  const addedPrograms = [
    ...new Set(
      afterResolved
        .map((instruction) => instruction.program)
        .filter((program) => !expectedResolved.some((instruction) => instruction.program === program)),
    ),
  ];

  if (
    businessAfter.length !== businessBefore.length ||
    businessAfter.some((instruction, index) => !instructionEqual(instruction, businessBefore[index]))
  ) {
    return changed(
      "INSTRUCTION_CHANGED",
      "After removing wallet guards, the programs, accounts or instruction data no longer match Review; do not approve it.",
      addedPrograms,
    );
  }
  if (
    addedPrograms.some(
      (program) => program !== COMPUTE_BUDGET_PROGRAM && program !== LIGHTHOUSE_PROGRAM,
    )
  ) {
    return changed("PROGRAM_ADDED", `The wallet added an unreviewed program: ${addedPrograms.join(", ")}.`, addedPrograms);
  }
  if (computeInstructions.length === 0) {
    return changed("INSTRUCTION_CHANGED", "The compiled message changed without an allowed ComputeBudget instruction.");
  }
  const budget = computeBudget(computeInstructions);
  if (budget === "INVALID") {
    return changed(
      "COMPUTE_BUDGET_INVALID",
      "The wallet added an unrecognised, duplicated or out-of-range ComputeBudget request.",
      addedPrograms,
    );
  }

  const bounded = (args.guardPolicy ?? "SEND_PAIR") === "BOUNDED";
  const resolvedLighthouse = lighthouseInstructions.map((instruction) => resolve(after, instruction, expandedAfter));
  /* Every account the reviewed transaction named — including the ones it
     named through a lookup table. Reading only the static keys made "an
     account the Review already named" mean "one of the two the message spelled
     out", and refused an honest assertion about the other three. */
  const reviewedAccounts: readonly ExpandedAccount[] =
    expandedBefore ??
    before.staticAccounts.map((account, index) => ({ address: String(account), role: accountRole(before, index) }));
  const lighthouseAssertions: Array<{
    kind: "ASSERT_ACCOUNT_INFO_MULTI" | "ASSERT_TOKEN_ACCOUNT_MULTI";
    account: string;
  }> = [];
  /* Kept as a record rather than as a refusal: whether every assertion the
     wallet added sits after the whole transfer, which is what makes it a claim
     about the outcome instead of about the state going in. */
  let assertionsFollowTransfer = true;
  if (resolvedLighthouse.length > 0) {
    const businessLastIndex = afterResolved.reduce(
      (last, instruction, index) =>
        instruction.program === COMPUTE_BUDGET_PROGRAM || instruction.program === LIGHTHOUSE_PROGRAM
          ? last
          : index,
      -1,
    );
    const guardFirstIndex = afterResolved.findIndex((instruction) => instruction.program === LIGHTHOUSE_PROGRAM);
    const seenKinds = new Set<number>();
    for (const instruction of resolvedLighthouse) {
      const raw = instruction.data;
      const discriminator = raw.slice(0, 2);
      const bytes = Uint8Array.from(raw.match(/../g) ?? [], (entry) => Number.parseInt(entry, 16));
      const kind = bytes[0];
      const logLevel = bytes[1];
      /* Every reason this can refuse, named.
         The refusal used to print one sentence and a discriminator for eight
         different conditions, so a founder who hit it on the bridge learned
         only that something was wrong — and `06` is a variant this guard
         *accepts*, which made the sentence read as a contradiction. The rule is
         unchanged; what changed is that it says which clause stopped it, so the
         next attempt is evidence instead of another guess. */
      /* Position is not a safety property, and treating it as one refused an
         honest wallet on the one transfer this task exists to make.

         Everything protecting the money is settled above and none of it depends
         on where an assertion sits: every business instruction is compared
         byte-for-byte and in order once the guard programs are filtered out, no
         program other than ComputeBudget and Lighthouse may appear at all, the
         variant must be one of two read-only asserts, and in bounded mode each
         must target an account the Review already named. A Lighthouse
         instruction can only read and abort. It cannot move value from any
         position in the list.

         What position does change is what the assertion proves: one placed
         before the transfer describes the state going in rather than the state
         coming out. That is a weaker proof, not an attack, so it is recorded
         and the outcome says which it was. Phantom put one before the last
         business instruction on the CCTP burn, and this clause made the burn
         unsignable. */
      const refusal =
        instruction.accounts.length !== 1
            ? `it names ${instruction.accounts.length} accounts and an assertion may name exactly one`
            : bytes.length < 4 || bytes.length > 512
              ? `its payload is ${bytes.length} bytes, outside the 4 to 512 this guard accepts`
              : kind !== 6 && kind !== 10
                ? `its variant is ${kind} and only 6 and 10 are recognised`
                : logLevel > LIGHTHOUSE_MAX_LOG_LEVEL
                  ? `its log level is ${logLevel}, above the ${LIGHTHOUSE_MAX_LOG_LEVEL} Lighthouse defines`
                  : bytes[2] === 0
                    ? "its assertion list is empty"
                    : bounded
                      ? resolvedLighthouse.length > 8
                        ? `the wallet added ${resolvedLighthouse.length} assertions and at most 8 are accepted`
                        : null
                      : seenKinds.has(kind)
                        ? `the wallet added more than one assertion of variant ${kind}`
                        : null;
      if (refusal !== null) {
        return changed(
          "WALLET_GUARD_INVALID",
          `The wallet's Lighthouse assertion (${discriminator}) was not accepted: ${refusal}. Nothing was signed.`,
          addedPrograms,
        );
      }
      if (guardFirstIndex <= businessLastIndex) assertionsFollowTransfer = false;
      const target = instruction.accounts[0];
      if (bounded) {
        /* The one target rule that survives: a wallet may assert only on
           accounts the Review already named. An assertion about something the
           person never saw is a guard about a different transaction. */
        if (!reviewedAccounts.some((entry) => entry.address === target)) {
          return changed(
            "WALLET_GUARD_INVALID",
            "The wallet added an assertion about an account that was not in the reviewed transaction.",
            addedPrograms,
          );
        }
        seenKinds.add(kind);
        lighthouseAssertions.push({
          kind: kind === 6 ? "ASSERT_ACCOUNT_INFO_MULTI" : "ASSERT_TOKEN_ACCOUNT_MULTI",
          account: target,
        });
        continue;
      }
      if (kind === 6 && target !== reviewedAccounts[0]?.address) {
        return changed(
          "WALLET_GUARD_INVALID",
          "The Lighthouse account-info assertion does not target the reviewed fee payer.",
          addedPrograms,
        );
      }
      if (kind === 10) {
        const entry = reviewedAccounts.find((account) => account.address === target);
        if (!entry || entry.role !== "NON_SIGNER:WRITABLE") {
          return changed(
            "WALLET_GUARD_INVALID",
            "The Lighthouse token assertion does not target an existing writable business account.",
            addedPrograms,
          );
        }
      }
      seenKinds.add(kind);
      lighthouseAssertions.push({
        kind: kind === 6 ? "ASSERT_ACCOUNT_INFO_MULTI" : "ASSERT_TOKEN_ACCOUNT_MULTI",
        account: target,
      });
    }
    /* The account-info assertion is always expected; the token assertion only
       when the message contains a token account to assert on. */
    const expectsTokenGuard = args.expectsTokenGuard ?? true;
    if (!bounded && (!seenKinds.has(6) || (expectsTokenGuard && !seenKinds.has(10)))) {
      return changed(
        "WALLET_GUARD_INVALID",
        expectsTokenGuard
          ? "The wallet's Lighthouse guard pair is incomplete."
          : "The wallet's Lighthouse account-info assertion is missing.",
        addedPrograms,
      );
    }
  }

  const unexpectedAccounts = after.staticAccounts
    .map(String)
    .filter((account) => !before.staticAccounts.some((expectedAccount) => String(expectedAccount) === account));
  if (
    unexpectedAccounts.some(
      (account) =>
        (account !== COMPUTE_BUDGET_PROGRAM && account !== LIGHTHOUSE_PROGRAM) ||
        accountRole(after, after.staticAccounts.findIndex((entry) => String(entry) === account)) !== "NON_SIGNER:READONLY",
    )
  ) {
    return changed("ACCOUNT_ROLE_CHANGED", "The wallet added an account outside the read-only ComputeBudget program.", addedPrograms);
  }

  return {
    verdict: "WALLET_GUARDS_ONLY",
    reasonCode: "EXACT",
    detail: `The wallet kept the same recipient, same mint, same amount, same blockhash and same signer, and added only a compute limit of ${grouped(budget.unitLimit)} units at ${grouped(budget.microLamportsPerUnit)} microLamports per compute unit (at most ${grouped(budget.maximumPriorityFeeLamports)} extra lamports)${
      lighthouseAssertions.length > 0
        ? assertionsFollowTransfer
          ? ` plus ${lighthouseAssertions.length} Lighthouse assertion(s), all placed after the transfer`
          : ` plus ${lighthouseAssertions.length} Lighthouse assertion(s), at least one placed before the transfer completes, so it checks the state going in rather than the outcome`
        : ""
    }.`,
    addedPrograms,
    computeBudget: budget,
    lighthouseAssertions,
  };
}
